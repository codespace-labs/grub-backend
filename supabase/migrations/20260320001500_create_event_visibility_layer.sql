create extension if not exists unaccent;

create or replace function public.app_event_visibility_reason(
  event_name text,
  genre_slugs text[] default '{}'::text[]
)
returns text
language sql
immutable
as $$
  with normalized as (
    select
      lower(unaccent(coalesce(event_name, ''))) as name_norm,
      coalesce(genre_slugs, '{}'::text[]) as genres
  )
  select case
    when name_norm ~ '(^|[^a-z])(tributo|tribute|homenaje|revive|x siempre|cerati x siempre)([^a-z]|$)'
      then 'editorial_tribute'
    when name_norm ~ '(^|[^a-z])(para ninos|para niños|infantil|infantiles|ninos|niños|kids)([^a-z]|$)'
      then 'editorial_childrens'
    when name_norm ~ '(^|[^a-z])(cumbia|chicha|huayno|huaynos)([^a-z]|$)'
      or genres && array['cumbia', 'cumbia-andina']::text[]
      then 'editorial_cumbia'
    when name_norm ~ '(^|[^a-z])(folklore|folklorica|folklorico|folkloricos|folkloricas|andino|andinos|criollo|criollos)([^a-z]|$)'
      or genres && array['folklore']::text[]
      then 'editorial_folklore'
    else null
  end
  from normalized;
$$;

create or replace view public.event_visibility as
with genre_map as (
  select
    e.id,
    coalesce(
      array_agg(distinct g.slug) filter (where g.slug is not null),
      '{}'::text[]
    ) as genre_slugs
  from public.events e
  left join public.event_genres eg on eg.event_id = e.id
  left join public.genres g on g.id = eg.genre_id
  group by e.id
)
select
  e.id,
  e.name,
  e.date,
  e.start_time,
  e.city,
  e.country_code,
  e.source,
  e.ticket_url,
  e.cover_url,
  e.is_active,
  gm.genre_slugs,
  public.app_event_visibility_reason(e.name, gm.genre_slugs) as visibility_reason,
  (
    e.is_active = true
    and e.cover_url is not null
    and public.app_event_visibility_reason(e.name, gm.genre_slugs) is null
  ) as is_visible_in_app
from public.events e
left join genre_map gm on gm.id = e.id;

create or replace view public.app_visible_events_catalog as
select *
from public.event_visibility
where is_visible_in_app = true;

grant execute on function public.app_event_visibility_reason(text, text[]) to anon, authenticated, service_role;
grant select on public.event_visibility to anon, authenticated, service_role;
grant select on public.app_visible_events_catalog to anon, authenticated, service_role;
