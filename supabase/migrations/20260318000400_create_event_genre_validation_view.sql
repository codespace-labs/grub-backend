-- Genre validation view for scraped events.
-- Flags:
--   missing_genre              -> title has genre-like signals but event_genres is empty
--   genre_mismatch             -> title has genre-like signals but assigned genres do not match
--   missing_genre_from_artists -> artist genres exist but event_genres is empty
--   artist_genre_mismatch      -> assigned genres do not overlap with artist genres

create extension if not exists unaccent;

drop view if exists public.event_genre_validation;

create or replace view public.event_genre_validation as
with event_base as (
  select
    e.id,
    e.source,
    e.name,
    e.venue,
    e.city,
    e.country_code,
    e.ticket_url,
    coalesce(
      array_agg(distinct g.slug) filter (where g.slug is not null),
      '{}'::text[]
    ) as assigned_genres,
    coalesce(
      array_agg(distinct g_artist.slug) filter (where g_artist.slug is not null),
      '{}'::text[]
    ) as artist_genres
  from public.events e
  left join public.event_genres eg
    on eg.event_id = e.id
  left join public.genres g
    on g.id = eg.genre_id
  left join public.event_artists ea
    on ea.event_id = e.id
  left join public.artist_genres ag
    on ag.artist_id = ea.artist_id
  left join public.genres g_artist
    on g_artist.id = ag.genre_id
  where e.is_active = true
  group by e.id, e.source, e.name, e.venue, e.city, e.country_code, e.ticket_url
),
signals as (
  select
    eb.*,
    array_remove(array[
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(techno)($|[^a-z])' then 'techno' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(house|tech house|deep house)($|[^a-z])' then 'house' end,
      case when lower(unaccent(eb.name)) ~ 'reggaet' then 'reggaeton' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(salsa)($|[^a-z])' then 'salsa' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(cumbia)($|[^a-z])' then 'cumbia' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(rock|grunge)($|[^a-z])' then 'rock' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(metal|deathcore|death metal)($|[^a-z])' then 'metal' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(hip hop|hip-hop|rap)($|[^a-z])' then 'hip-hop' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(trap)($|[^a-z])' then 'trap' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(indie)($|[^a-z])' then 'indie' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(electro|edm|rave|electronica)($|[^a-z])' then 'electronica' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(k pop|k-pop|kpop)($|[^a-z])' then 'kpop' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(pop)($|[^a-z])' then 'pop' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(jazz)($|[^a-z])' then 'jazz' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(clasica|clasico|classical|sinfonic|orquesta|filarmonic|guitarra clasica)($|[^a-z])' then 'clasica' end,
      case when lower(unaccent(eb.name)) ~ '(^|[^a-z])(folklore|criollo|andino)($|[^a-z])' then 'folklore' end
    ]::text[], null) as inferred_genres
  from event_base eb
)
select
  s.id,
  s.source,
  s.name,
  s.venue,
  s.city,
  s.country_code,
  s.ticket_url,
  s.assigned_genres,
  s.inferred_genres,
  s.artist_genres,
  cardinality(s.assigned_genres) = 0 as has_no_assigned_genres,
  cardinality(s.inferred_genres) > 0 as has_genre_signals,
  cardinality(s.artist_genres) > 0 as has_artist_genres,
  cardinality(s.inferred_genres) > 0
    and cardinality(s.assigned_genres) = 0 as missing_genre,
  cardinality(s.inferred_genres) > 0
    and cardinality(s.assigned_genres) > 0
    and not (s.assigned_genres && s.inferred_genres) as genre_mismatch,
  cardinality(s.artist_genres) > 0
    and cardinality(s.assigned_genres) = 0 as missing_genre_from_artists,
  cardinality(s.artist_genres) > 0
    and cardinality(s.assigned_genres) > 0
    and not (s.assigned_genres && s.artist_genres) as artist_genre_mismatch,
  case
    when cardinality(s.artist_genres) > 0
      and cardinality(s.assigned_genres) = 0
      then 'missing_genre_from_artists'
    when cardinality(s.inferred_genres) > 0
      and cardinality(s.assigned_genres) = 0
      then 'missing_genre'
    when cardinality(s.artist_genres) > 0
      and cardinality(s.assigned_genres) > 0
      and not (s.assigned_genres && s.artist_genres)
      then 'artist_genre_mismatch'
    when cardinality(s.inferred_genres) > 0
      and cardinality(s.assigned_genres) > 0
      and not (s.assigned_genres && s.inferred_genres)
      then 'genre_mismatch'
    else null
  end as validation_status
from signals s;
