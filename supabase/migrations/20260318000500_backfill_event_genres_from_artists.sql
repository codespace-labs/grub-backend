-- Build event_artists from legacy events.lineup and backfill event genres
-- from artist genres. Later migrations may refine the prioritization logic,
-- but this file establishes the reusable primitives.

create extension if not exists unaccent;

create or replace function public.slugify_artist_name(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(lower(unaccent(coalesce(input, ''))), '[^a-z0-9]+', '-', 'g'),
    '-+',
    '-',
    'g'
  ));
$$;

create or replace function public.sync_event_artists_from_lineup()
returns table(inserted_artists bigint, inserted_links bigint)
language plpgsql
as $$
declare
  before_artists bigint;
  before_links bigint;
begin
  select count(*) into before_artists from public.artists;
  select count(*) into before_links from public.event_artists;

  with lineup_rows as (
    select
      e.id as event_id,
      btrim(lineup_item.artist_name) as artist_name,
      (lineup_item.ordinality - 1)::smallint as order_index,
      public.slugify_artist_name(btrim(lineup_item.artist_name)) as artist_slug
    from public.events e
    cross join lateral unnest(coalesce(e.lineup, '{}'::text[]))
      with ordinality as lineup_item(artist_name, ordinality)
    where e.is_active = true
      and lineup_item.artist_name is not null
      and btrim(lineup_item.artist_name) <> ''
  )
  insert into public.artists (name, slug)
  select distinct
    lr.artist_name,
    lr.artist_slug
  from lineup_rows lr
  where lr.artist_slug <> ''
  on conflict (slug) do nothing;

  with lineup_rows as (
    select
      e.id as event_id,
      btrim(lineup_item.artist_name) as artist_name,
      (lineup_item.ordinality - 1)::smallint as order_index,
      public.slugify_artist_name(btrim(lineup_item.artist_name)) as artist_slug
    from public.events e
    cross join lateral unnest(coalesce(e.lineup, '{}'::text[]))
      with ordinality as lineup_item(artist_name, ordinality)
    where e.is_active = true
      and lineup_item.artist_name is not null
      and btrim(lineup_item.artist_name) <> ''
  )
  insert into public.event_artists (event_id, artist_id, order_index)
  select distinct
    lr.event_id,
    a.id,
    lr.order_index
  from lineup_rows lr
  join public.artists a
    on a.slug = lr.artist_slug
  left join public.event_artists ea
    on ea.event_id = lr.event_id
   and ea.artist_id = a.id
  where ea.event_id is null
  on conflict do nothing;

  return query
  select
    (select count(*) from public.artists) - before_artists,
    (select count(*) from public.event_artists) - before_links;
end;
$$;

create or replace function public.backfill_event_genres_from_artists()
returns table(inserted_event_genres bigint)
language plpgsql
as $$
declare
  before_count bigint;
begin
  perform public.sync_event_artists_from_lineup();

  select count(*) into before_count from public.event_genres;

  insert into public.event_genres (event_id, genre_id)
  select distinct
    ea.event_id,
    ag.genre_id
  from public.event_artists ea
  join public.artist_genres ag
    on ag.artist_id = ea.artist_id
  left join public.event_genres eg
    on eg.event_id = ea.event_id
   and eg.genre_id = ag.genre_id
  where eg.event_id is null
    and not exists (
      select 1
      from public.event_genres existing
      where existing.event_id = ea.event_id
    )
  on conflict do nothing;

  return query
  select (select count(*) from public.event_genres) - before_count;
end;
$$;
