alter table public.events
  add column if not exists pipeline_excluded boolean not null default false,
  add column if not exists pipeline_excluded_reason text null,
  add column if not exists pipeline_excluded_at timestamptz null;

create index if not exists events_pipeline_excluded_idx
  on public.events (pipeline_excluded, is_active, date);

drop view if exists public.app_visible_events_catalog;
create view public.app_visible_events_catalog as
with genre_map as (
  select
    e.id,
    coalesce(
      array_agg(distinct g.slug) filter (where g.slug is not null),
      '{}'::text[]
    ) as genre_slugs,
    coalesce(
      array_agg(distinct g.canonical_slug) filter (where g.canonical_slug is not null),
      '{}'::text[]
    ) as genres_canonical
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
  e.pipeline_excluded,
  e.pipeline_excluded_reason,
  gm.genre_slugs,
  gm.genres_canonical,
  public.app_event_visibility_reason(e.name, gm.genre_slugs) as visibility_reason,
  (
    e.is_active = true
    and coalesce(e.pipeline_excluded, false) = false
    and e.cover_url is not null
    and public.app_event_visibility_reason(e.name, gm.genre_slugs) is null
  ) as is_visible_in_app
from public.events e
left join genre_map gm on gm.id = e.id
where
  e.is_active = true
  and coalesce(e.pipeline_excluded, false) = false
  and e.cover_url is not null
  and public.app_event_visibility_reason(e.name, gm.genre_slugs) is null;

grant select on public.app_visible_events_catalog to anon, authenticated, service_role;
