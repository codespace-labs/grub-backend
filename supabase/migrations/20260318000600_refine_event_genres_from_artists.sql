-- Refine automatic event genre backfill.
-- Goal: avoid copying every MusicBrainz tag from every linked artist.
-- Strategy:
--   1. Only use the headliner / first artist in event_artists (order_index = 0)
--   2. Prefer high-signal genres
--   3. Limit automatic propagation to at most 2 genres per event

create or replace function public.backfill_event_genres_from_artists()
returns table(inserted_event_genres bigint)
language plpgsql
as $$
declare
  before_count bigint;
begin
  perform public.sync_event_artists_from_lineup();

  select count(*) into before_count from public.event_genres;

  with ranked_artist_genres as (
    select
      ea.event_id,
      ag.genre_id,
      g.slug,
      row_number() over (
        partition by ea.event_id
        order by
          case g.slug
            when 'rock' then 1
            when 'metal' then 2
            when 'kpop' then 3
            when 'clasica' then 4
            when 'salsa' then 5
            when 'cumbia' then 6
            when 'reggaeton' then 7
            when 'pop-latino' then 8
            when 'pop' then 9
            when 'indie' then 10
            when 'alternativo' then 11
            when 'electronica' then 12
            when 'techno' then 13
            when 'house' then 14
            when 'jazz' then 15
            when 'folklore' then 16
            when 'hip-hop' then 17
            when 'trap' then 18
            when 'balada' then 19
            when 'latin-bass' then 20
            else 99
          end,
          g.slug
      ) as rn
    from public.event_artists ea
    join public.artist_genres ag
      on ag.artist_id = ea.artist_id
    join public.genres g
      on g.id = ag.genre_id
    where ea.order_index = 0
      and g.slug in (
        'rock', 'metal', 'kpop', 'clasica', 'salsa', 'cumbia',
        'reggaeton', 'pop-latino', 'pop', 'indie', 'alternativo',
        'electronica', 'techno', 'house', 'jazz', 'folklore',
        'hip-hop', 'trap', 'balada', 'latin-bass'
      )
  ),
  selected_genres as (
    select
      rag.event_id,
      rag.genre_id
    from ranked_artist_genres rag
    where rag.rn <= 2
  )
  insert into public.event_genres (event_id, genre_id)
  select distinct
    sg.event_id,
    sg.genre_id
  from selected_genres sg
  join public.events e
    on e.id = sg.event_id
  left join public.event_genres eg
    on eg.event_id = sg.event_id
   and eg.genre_id = sg.genre_id
  where eg.event_id is null
    and not exists (
      select 1
      from public.event_genres eg_existing
      where eg_existing.event_id = sg.event_id
    )
  on conflict do nothing;

  return query
  select (select count(*) from public.event_genres) - before_count;
end;
$$;

create or replace view public.suspicious_event_genres as
select
  e.id,
  e.source,
  e.name,
  array_agg(distinct g.slug order by g.slug) as event_genres
from public.events e
join public.event_genres eg on eg.event_id = e.id
join public.genres g on g.id = eg.genre_id
where e.is_active = true
group by e.id, e.source, e.name
having
  count(distinct g.slug) > 2
  or (
    bool_or(g.slug = 'hip-hop')
    and lower(unaccent(e.name)) ~ '(tributo|raphael|juan gabriel|sandro|dyango|romantic|intimo)'
  )
  or (
    bool_or(g.slug = 'latin-bass')
    and lower(unaccent(e.name)) ~ '(no te va gustar|rock)'
  )
  or (
    bool_or(g.slug = 'house')
    and lower(unaccent(e.name)) ~ '(chapterhouse)'
  )
  or (
    bool_or(g.slug = 'salsa')
    and lower(unaccent(e.name)) ~ '(yuri)'
  );
