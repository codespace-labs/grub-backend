-- Mantener una sola integración Ticketmaster para Perú (web scraping / Firecrawl)
-- y consolidar posibles duplicados históricos importados por la API anterior.

-- 1) Normalizar URLs afiliadas antiguas a la URL limpia de ticketmaster.pe
update public.events
set ticket_url = 'https://www.ticketmaster.pe/event/' ||
  regexp_replace(
    regexp_replace(
      ticket_url,
      '.*u=https%3A%2F%2Fwww\.ticketmaster\.pe%2Fevent%2F',
      ''
    ),
    '&.*',
    ''
  )
where source = 'ticketmaster'
  and ticket_url like '%ticketmaster.evyy.net%';

-- 2) Backfill de external_slug para filas viejas que no lo tengan
update public.events
set external_slug = lower(substring(ticket_url from 'ticketmaster\.pe/event/([^?&/]+)'))
where source = 'ticketmaster'
  and (external_slug is null or btrim(external_slug) = '')
  and ticket_url ~ 'ticketmaster\.pe/event/[^?&/]+';

create temporary table tmp_ticketmaster_duplicate_map as
with ranked as (
  select
    e.id,
    first_value(e.id) over (
      partition by coalesce(
        nullif(e.external_slug, ''),
        lower(substring(e.ticket_url from 'ticketmaster\.pe/event/([^?&/]+)')),
        regexp_replace(lower(unaccent(e.name)), '[^a-z0-9]+', ' ', 'g')
          || '|' || ((e.date at time zone 'America/Lima')::date)::text
          || '|' || regexp_replace(lower(unaccent(coalesce(e.city, ''))), '[^a-z0-9]+', ' ', 'g')
      )
      order by
        case when e.ticket_url ~ '^https://www\.ticketmaster\.pe/event/' then 0 else 1 end,
        case when e.is_active then 0 else 1 end,
        case when e.cover_url is not null then 0 else 1 end,
        case when e.price_min is not null then 0 else 1 end,
        e.created_at desc,
        e.id
    ) as winner_id,
    row_number() over (
      partition by coalesce(
        nullif(e.external_slug, ''),
        lower(substring(e.ticket_url from 'ticketmaster\.pe/event/([^?&/]+)')),
        regexp_replace(lower(unaccent(e.name)), '[^a-z0-9]+', ' ', 'g')
          || '|' || ((e.date at time zone 'America/Lima')::date)::text
          || '|' || regexp_replace(lower(unaccent(coalesce(e.city, ''))), '[^a-z0-9]+', ' ', 'g')
      )
      order by
        case when e.ticket_url ~ '^https://www\.ticketmaster\.pe/event/' then 0 else 1 end,
        case when e.is_active then 0 else 1 end,
        case when e.cover_url is not null then 0 else 1 end,
        case when e.price_min is not null then 0 else 1 end,
        e.created_at desc,
        e.id
    ) as rn
  from public.events e
  where e.source = 'ticketmaster'
)
select id as loser_id, winner_id
from ranked
where rn > 1
  and winner_id <> id;

insert into public.event_genres (event_id, genre_id)
select distinct
  m.winner_id,
  eg.genre_id
from tmp_ticketmaster_duplicate_map m
join public.event_genres eg
  on eg.event_id = m.loser_id
where not exists (
  select 1
  from public.event_genres existing
  where existing.event_id = m.winner_id
    and existing.genre_id = eg.genre_id
);

insert into public.event_artists (event_id, artist_id, order_index)
select
  m.winner_id,
  ea.artist_id,
  min(ea.order_index) as order_index
from tmp_ticketmaster_duplicate_map m
join public.event_artists ea
  on ea.event_id = m.loser_id
where not exists (
  select 1
  from public.event_artists existing
  where existing.event_id = m.winner_id
    and existing.artist_id = ea.artist_id
)
group by m.winner_id, ea.artist_id;

update admin.manual_event_overrides mo
set event_id = m.winner_id
from tmp_ticketmaster_duplicate_map m
where mo.event_id = m.loser_id;

update quality.quality_issues qi
set entity_id = m.winner_id
from tmp_ticketmaster_duplicate_map m
where qi.entity_type = 'event'
  and qi.entity_id = m.loser_id;

update admin.audit_logs al
set entity_id = m.winner_id
from tmp_ticketmaster_duplicate_map m
where al.entity_type = 'event'
  and al.entity_id = m.loser_id;

delete from public.events e
using tmp_ticketmaster_duplicate_map m
where e.id = m.loser_id;
