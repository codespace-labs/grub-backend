create extension if not exists pgcrypto;
create extension if not exists unaccent;
create extension if not exists vector;

create table if not exists public.event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source text null,
  starts_at timestamptz not null,
  local_date date not null,
  start_time time null,
  timezone text not null default 'America/Lima',
  venue_id uuid null references public.venues(id) on delete set null,
  venue_name text null,
  city text null,
  country_code char(2) not null default 'PE',
  status text not null default 'scheduled',
  is_primary boolean not null default true,
  legacy_event_date timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_occurrences_status_check check (status in ('scheduled', 'cancelled', 'postponed', 'unknown'))
);

create index if not exists event_occurrences_starts_at_idx
  on public.event_occurrences (starts_at);

create index if not exists event_occurrences_venue_starts_at_idx
  on public.event_occurrences (venue_id, starts_at);

create index if not exists event_occurrences_future_idx
  on public.event_occurrences (starts_at)
  where status <> 'cancelled';

create unique index if not exists event_occurrences_primary_uidx
  on public.event_occurrences (event_id)
  where is_primary;

create table if not exists public.event_sources (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source text not null,
  country_code char(2) not null default 'PE',
  source_event_key text null,
  external_slug text null,
  ticket_url text null,
  observed_availability_status text not null default 'available',
  price_min numeric null,
  price_max numeric null,
  cover_url text null,
  raw_payload jsonb not null default '{}'::jsonb,
  payload_checksum text null,
  is_primary boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_sources_source_check check (
    source in (
      'manual',
      'ticketmaster',
      'ticketmaster-pe',
      'teleticket',
      'joinnus',
      'vastion',
      'tikpe',
      'passline',
      'superboletos'
    )
  ),
  constraint event_sources_observed_availability_status_check check (
    observed_availability_status in ('available', 'sold_out', 'cancelled', 'unknown')
  )
);

create unique index if not exists event_sources_source_event_key_uidx
  on public.event_sources (source, source_event_key)
  where source_event_key is not null;

create unique index if not exists event_sources_source_external_slug_uidx
  on public.event_sources (source, external_slug, country_code)
  where external_slug is not null;

create unique index if not exists event_sources_source_ticket_url_uidx
  on public.event_sources (source, ticket_url)
  where ticket_url is not null;

create unique index if not exists event_sources_primary_per_event_source_uidx
  on public.event_sources (event_id, source)
  where is_primary;

create index if not exists event_sources_event_source_idx
  on public.event_sources (event_id, source);

create index if not exists event_sources_source_last_seen_idx
  on public.event_sources (source, last_seen_at desc);

create table if not exists public.event_search (
  event_id uuid primary key references public.events(id) on delete cascade,
  searchable_text text not null default '',
  search_document tsvector null,
  embedding vector null,
  primary_artist_names text[] not null default '{}'::text[],
  genre_slugs text[] not null default '{}'::text[],
  venue_name text null,
  city text null,
  country_code char(2) null,
  starts_at timestamptz null,
  refreshed_at timestamptz not null default now()
);

create index if not exists event_search_document_idx
  on public.event_search
  using gin (search_document);

create index if not exists event_search_country_starts_at_idx
  on public.event_search (country_code, starts_at);

create table if not exists public.event_assets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source text null,
  asset_kind text not null default 'cover',
  url text not null,
  origin text not null default 'legacy_events',
  sort_order smallint not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_assets_kind_check check (asset_kind in ('cover', 'poster', 'gallery', 'video', 'other'))
);

create unique index if not exists event_assets_event_kind_url_uidx
  on public.event_assets (event_id, asset_kind, url);

create index if not exists event_assets_event_primary_idx
  on public.event_assets (event_id, is_primary, sort_order);

create index if not exists event_artists_artist_event_idx
  on public.event_artists (artist_id, event_id);

create index if not exists event_genres_genre_event_idx
  on public.event_genres (genre_id, event_id);

create index if not exists events_active_date_idx
  on public.events (is_active, date);

create index if not exists events_venue_date_idx
  on public.events (venue_id, date);

create or replace function public.legacy_event_starts_at(
  event_date timestamptz,
  explicit_starts_at timestamptz,
  explicit_start_time time
)
returns timestamptz
language sql
immutable
as $$
  select coalesce(
    explicit_starts_at,
    case
      when event_date is null then null
      when explicit_start_time is not null
        then date_trunc('day', event_date) + explicit_start_time
      else event_date
    end
  );
$$;

create or replace function public.sync_event_artists_from_lineup_event(p_event_id uuid)
returns void
language plpgsql
as $$
begin
  with lineup_rows as (
    select
      e.id as event_id,
      btrim(lineup_item.artist_name) as artist_name,
      (lineup_item.ordinality - 1)::smallint as order_index,
      public.slugify_artist_name(btrim(lineup_item.artist_name)) as artist_slug
    from public.events e
    cross join lateral unnest(coalesce(e.lineup, '{}'::text[]))
      with ordinality as lineup_item(artist_name, ordinality)
    where e.id = p_event_id
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
    where e.id = p_event_id
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
end;
$$;

create or replace function public.sync_event_occurrence_projection(p_event_id uuid)
returns void
language plpgsql
as $$
begin
  insert into public.event_occurrences (
    event_id,
    source,
    starts_at,
    local_date,
    start_time,
    timezone,
    venue_id,
    venue_name,
    city,
    country_code,
    status,
    is_primary,
    legacy_event_date,
    updated_at
  )
  select
    e.id,
    e.source,
    public.legacy_event_starts_at(e.date, e.starts_at, e.start_time) as starts_at,
    (public.legacy_event_starts_at(e.date, e.starts_at, e.start_time) at time zone 'America/Lima')::date as local_date,
    coalesce(
      e.start_time,
      (public.legacy_event_starts_at(e.date, e.starts_at, e.start_time) at time zone 'America/Lima')::time
    ) as start_time,
    'America/Lima',
    e.venue_id,
    e.venue,
    e.city,
    e.country_code,
    case
      when e.availability = 'cancelled' then 'cancelled'
      else 'scheduled'
    end,
    true,
    e.date,
    now()
  from public.events e
  where e.id = p_event_id
    and public.legacy_event_starts_at(e.date, e.starts_at, e.start_time) is not null
  on conflict (event_id) where is_primary
  do update set
    source = excluded.source,
    starts_at = excluded.starts_at,
    local_date = excluded.local_date,
    start_time = excluded.start_time,
    timezone = excluded.timezone,
    venue_id = excluded.venue_id,
    venue_name = excluded.venue_name,
    city = excluded.city,
    country_code = excluded.country_code,
    status = excluded.status,
    legacy_event_date = excluded.legacy_event_date,
    updated_at = now();
end;
$$;

create or replace function public.sync_event_source_projection(p_event_id uuid)
returns void
language plpgsql
as $$
begin
  insert into public.event_sources (
    event_id,
    source,
    country_code,
    source_event_key,
    external_slug,
    ticket_url,
    observed_availability_status,
    price_min,
    price_max,
    cover_url,
    raw_payload,
    payload_checksum,
    is_primary,
    first_seen_at,
    last_seen_at,
    updated_at
  )
  select
    e.id,
    e.source,
    e.country_code,
    coalesce(nullif(e.external_slug, ''), nullif(e.ticket_url, ''), e.id::text),
    nullif(e.external_slug, ''),
    nullif(e.ticket_url, ''),
    coalesce(nullif(e.availability_status, ''), 'unknown'),
    e.price_min,
    e.price_max,
    e.cover_url,
    jsonb_strip_nulls(jsonb_build_object(
      'legacy_event_id', e.id,
      'source', e.source,
      'ticket_url', e.ticket_url,
      'external_slug', e.external_slug
    )),
    md5(concat_ws(
      '|',
      coalesce(e.source, ''),
      coalesce(e.country_code::text, ''),
      coalesce(e.ticket_url, ''),
      coalesce(e.external_slug, ''),
      coalesce(e.price_min::text, ''),
      coalesce(e.price_max::text, ''),
      coalesce(e.cover_url, ''),
      coalesce(e.availability_status, '')
    )),
    true,
    coalesce(e.created_at, now()),
    now(),
    now()
  from public.events e
  where e.id = p_event_id
  on conflict (event_id, source) where is_primary
  do update set
    country_code = excluded.country_code,
    source_event_key = excluded.source_event_key,
    external_slug = excluded.external_slug,
    ticket_url = excluded.ticket_url,
    observed_availability_status = excluded.observed_availability_status,
    price_min = excluded.price_min,
    price_max = excluded.price_max,
    cover_url = excluded.cover_url,
    raw_payload = excluded.raw_payload,
    payload_checksum = excluded.payload_checksum,
    last_seen_at = now(),
    updated_at = now();
end;
$$;

create or replace function public.sync_event_assets_projection(p_event_id uuid)
returns void
language plpgsql
as $$
declare
  asset_url text;
  asset_source text;
begin
  delete from public.event_assets
  where event_id = p_event_id
    and origin = 'legacy_events_cover';

  select e.cover_url, e.source
  into asset_url, asset_source
  from public.events e
  where e.id = p_event_id;

  if asset_url is null or btrim(asset_url) = '' then
    return;
  end if;

  insert into public.event_assets (
    event_id,
    source,
    asset_kind,
    url,
    origin,
    sort_order,
    is_primary,
    updated_at
  )
  values (
    p_event_id,
    asset_source,
    'cover',
    asset_url,
    'legacy_events_cover',
    0,
    true,
    now()
  )
  on conflict (event_id, asset_kind, url)
  do update set
    source = excluded.source,
    origin = excluded.origin,
    is_primary = true,
    updated_at = now();
end;
$$;

create or replace function public.refresh_event_search_projection(p_event_id uuid)
returns void
language plpgsql
as $$
begin
  insert into public.event_search (
    event_id,
    searchable_text,
    search_document,
    embedding,
    primary_artist_names,
    genre_slugs,
    venue_name,
    city,
    country_code,
    starts_at,
    refreshed_at
  )
  with event_base as (
    select
      e.id,
      e.name,
      e.venue,
      e.city,
      e.country_code,
      e.embedding,
      public.legacy_event_starts_at(e.date, e.starts_at, e.start_time) as computed_starts_at
    from public.events e
    where e.id = p_event_id
  ),
  artist_names as (
    select
      ea.event_id,
      array_agg(a.name order by ea.order_index, a.name) filter (where a.name is not null) as names
    from public.event_artists ea
    join public.artists a on a.id = ea.artist_id
    where ea.event_id = p_event_id
    group by ea.event_id
  ),
  genre_names as (
    select
      eg.event_id,
      array_agg(g.slug order by g.slug) filter (where g.slug is not null) as slugs,
      array_agg(g.name order by g.name) filter (where g.name is not null) as names
    from public.event_genres eg
    join public.genres g on g.id = eg.genre_id
    where eg.event_id = p_event_id
    group by eg.event_id
  )
  select
    eb.id,
    trim(concat_ws(
      ' ',
      eb.name,
      eb.venue,
      eb.city,
      array_to_string(coalesce(an.names, '{}'::text[]), ' '),
      array_to_string(coalesce(gn.names, '{}'::text[]), ' ')
    )) as searchable_text,
    to_tsvector(
      'simple',
      trim(concat_ws(
        ' ',
        eb.name,
        eb.venue,
        eb.city,
        array_to_string(coalesce(an.names, '{}'::text[]), ' '),
        array_to_string(coalesce(gn.names, '{}'::text[]), ' ')
      ))
    ),
    eb.embedding,
    coalesce(an.names, '{}'::text[]),
    coalesce(gn.slugs, '{}'::text[]),
    eb.venue,
    eb.city,
    eb.country_code,
    eb.computed_starts_at,
    now()
  from event_base eb
  left join artist_names an on an.event_id = eb.id
  left join genre_names gn on gn.event_id = eb.id
  on conflict (event_id)
  do update set
    searchable_text = excluded.searchable_text,
    search_document = excluded.search_document,
    embedding = excluded.embedding,
    primary_artist_names = excluded.primary_artist_names,
    genre_slugs = excluded.genre_slugs,
    venue_name = excluded.venue_name,
    city = excluded.city,
    country_code = excluded.country_code,
    starts_at = excluded.starts_at,
    refreshed_at = now();
end;
$$;

create or replace function public.sync_event_legacy_projections()
returns trigger
language plpgsql
as $$
begin
  perform public.sync_event_artists_from_lineup_event(new.id);
  perform public.sync_event_occurrence_projection(new.id);
  perform public.sync_event_source_projection(new.id);
  perform public.sync_event_assets_projection(new.id);
  perform public.refresh_event_search_projection(new.id);
  return new;
end;
$$;

drop trigger if exists sync_event_legacy_projections_trigger on public.events;

create trigger sync_event_legacy_projections_trigger
after insert or update of
  name,
  date,
  starts_at,
  start_time,
  venue,
  city,
  country_code,
  venue_id,
  lineup,
  ticket_url,
  cover_url,
  price_min,
  price_max,
  availability,
  availability_status,
  source,
  embedding
on public.events
for each row
execute function public.sync_event_legacy_projections();

create or replace function public.refresh_event_search_from_relation()
returns trigger
language plpgsql
as $$
begin
  perform public.refresh_event_search_projection(coalesce(new.event_id, old.event_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_event_search_from_event_artists_trigger on public.event_artists;
create trigger refresh_event_search_from_event_artists_trigger
after insert or update or delete on public.event_artists
for each row
execute function public.refresh_event_search_from_relation();

drop trigger if exists refresh_event_search_from_event_genres_trigger on public.event_genres;
create trigger refresh_event_search_from_event_genres_trigger
after insert or update or delete on public.event_genres
for each row
execute function public.refresh_event_search_from_relation();

insert into public.event_occurrences (
  event_id,
  source,
  starts_at,
  local_date,
  start_time,
  timezone,
  venue_id,
  venue_name,
  city,
  country_code,
  status,
  is_primary,
  legacy_event_date
)
select
  e.id,
  e.source,
  public.legacy_event_starts_at(e.date, e.starts_at, e.start_time) as starts_at,
  (public.legacy_event_starts_at(e.date, e.starts_at, e.start_time) at time zone 'America/Lima')::date as local_date,
  coalesce(
    e.start_time,
    (public.legacy_event_starts_at(e.date, e.starts_at, e.start_time) at time zone 'America/Lima')::time
  ) as start_time,
  'America/Lima',
  e.venue_id,
  e.venue,
  e.city,
  e.country_code,
  case
    when e.availability = 'cancelled' then 'cancelled'
    else 'scheduled'
  end,
  true,
  e.date
from public.events e
where public.legacy_event_starts_at(e.date, e.starts_at, e.start_time) is not null
on conflict (event_id) where is_primary do update set
  source = excluded.source,
  starts_at = excluded.starts_at,
  local_date = excluded.local_date,
  start_time = excluded.start_time,
  venue_id = excluded.venue_id,
  venue_name = excluded.venue_name,
  city = excluded.city,
  country_code = excluded.country_code,
  status = excluded.status,
  legacy_event_date = excluded.legacy_event_date,
  updated_at = now();

insert into public.event_sources (
  event_id,
  source,
  country_code,
  source_event_key,
  external_slug,
  ticket_url,
  observed_availability_status,
  price_min,
  price_max,
  cover_url,
  raw_payload,
  payload_checksum,
  is_primary,
  first_seen_at,
  last_seen_at
)
select
  e.id,
  e.source,
  e.country_code,
  coalesce(nullif(e.external_slug, ''), nullif(e.ticket_url, ''), e.id::text),
  nullif(e.external_slug, ''),
  nullif(e.ticket_url, ''),
  coalesce(nullif(e.availability_status, ''), 'unknown'),
  e.price_min,
  e.price_max,
  e.cover_url,
  jsonb_strip_nulls(jsonb_build_object(
    'legacy_event_id', e.id,
    'source', e.source,
    'ticket_url', e.ticket_url,
    'external_slug', e.external_slug
  )),
  md5(concat_ws(
    '|',
    coalesce(e.source, ''),
    coalesce(e.country_code::text, ''),
    coalesce(e.ticket_url, ''),
    coalesce(e.external_slug, ''),
    coalesce(e.price_min::text, ''),
    coalesce(e.price_max::text, ''),
    coalesce(e.cover_url, ''),
    coalesce(e.availability_status, '')
  )),
  true,
  coalesce(e.created_at, now()),
  now()
from public.events e
on conflict (event_id, source) where is_primary do update set
  country_code = excluded.country_code,
  source_event_key = excluded.source_event_key,
  external_slug = excluded.external_slug,
  ticket_url = excluded.ticket_url,
  observed_availability_status = excluded.observed_availability_status,
  price_min = excluded.price_min,
  price_max = excluded.price_max,
  cover_url = excluded.cover_url,
  raw_payload = excluded.raw_payload,
  payload_checksum = excluded.payload_checksum,
  last_seen_at = now(),
  updated_at = now();

delete from public.event_assets
where origin = 'legacy_events_cover';

insert into public.event_assets (
  event_id,
  source,
  asset_kind,
  url,
  origin,
  sort_order,
  is_primary
)
select
  e.id,
  e.source,
  'cover',
  e.cover_url,
  'legacy_events_cover',
  0,
  true
from public.events e
where e.cover_url is not null
  and btrim(e.cover_url) <> ''
on conflict (event_id, asset_kind, url) do update set
  source = excluded.source,
  origin = excluded.origin,
  is_primary = excluded.is_primary,
  updated_at = now();

select public.sync_event_artists_from_lineup();

insert into public.event_search (
  event_id,
  searchable_text,
  search_document,
  embedding,
  primary_artist_names,
  genre_slugs,
  venue_name,
  city,
  country_code,
  starts_at,
  refreshed_at
)
with artist_names as (
  select
    ea.event_id,
    array_agg(a.name order by ea.order_index, a.name) filter (where a.name is not null) as names
  from public.event_artists ea
  join public.artists a on a.id = ea.artist_id
  group by ea.event_id
),
genre_names as (
  select
    eg.event_id,
    array_agg(g.slug order by g.slug) filter (where g.slug is not null) as slugs,
    array_agg(g.name order by g.name) filter (where g.name is not null) as names
  from public.event_genres eg
  join public.genres g on g.id = eg.genre_id
  group by eg.event_id
)
select
  e.id,
  trim(concat_ws(
    ' ',
    e.name,
    e.venue,
    e.city,
    array_to_string(coalesce(an.names, '{}'::text[]), ' '),
    array_to_string(coalesce(gn.names, '{}'::text[]), ' ')
  )) as searchable_text,
  to_tsvector(
    'simple',
    trim(concat_ws(
      ' ',
      e.name,
      e.venue,
      e.city,
      array_to_string(coalesce(an.names, '{}'::text[]), ' '),
      array_to_string(coalesce(gn.names, '{}'::text[]), ' ')
    ))
  ),
  e.embedding,
  coalesce(an.names, '{}'::text[]),
  coalesce(gn.slugs, '{}'::text[]),
  e.venue,
  e.city,
  e.country_code,
  public.legacy_event_starts_at(e.date, e.starts_at, e.start_time),
  now()
from public.events e
left join artist_names an on an.event_id = e.id
left join genre_names gn on gn.event_id = e.id
on conflict (event_id) do update set
  searchable_text = excluded.searchable_text,
  search_document = excluded.search_document,
  embedding = excluded.embedding,
  primary_artist_names = excluded.primary_artist_names,
  genre_slugs = excluded.genre_slugs,
  venue_name = excluded.venue_name,
  city = excluded.city,
  country_code = excluded.country_code,
  starts_at = excluded.starts_at,
  refreshed_at = now();

create or replace view public.event_legacy_projection as
select
  e.id,
  e.name,
  e.description,
  e.date,
  e.starts_at,
  e.start_time,
  e.venue,
  e.city,
  e.country_code,
  e.venue_id,
  e.ticket_url,
  e.external_slug,
  e.price_min,
  e.price_max,
  e.cover_url,
  e.lineup,
  e.source,
  e.availability,
  e.availability_status,
  eo.id as occurrence_id,
  eo.starts_at as canonical_starts_at,
  eo.status as occurrence_status,
  es.id as source_row_id,
  es.source_event_key,
  es.observed_availability_status,
  es.last_seen_at
from public.events e
left join public.event_occurrences eo
  on eo.event_id = e.id
 and eo.is_primary = true
left join public.event_sources es
  on es.event_id = e.id
 and es.source = e.source
 and es.is_primary = true;

comment on column public.events.lineup is
  'LEGACY compatibility field. Canonical artist links now live in public.event_artists.';

comment on column public.events.venue is
  'LEGACY compatibility field. Canonical venue/location should flow through venue_id and public.event_occurrences/public.venues.';

comment on column public.events.city is
  'LEGACY compatibility field. Keep temporarily for reads while event_occurrences becomes canonical.';

comment on column public.events.ticket_url is
  'LEGACY compatibility field. Source-specific URLs now belong in public.event_sources.';

comment on column public.events.external_slug is
  'LEGACY compatibility field. Source-specific external identity now belongs in public.event_sources.';

comment on column public.events.price_min is
  'LEGACY compatibility field. Observed source prices now belong in public.event_sources.';

comment on column public.events.price_max is
  'LEGACY compatibility field. Observed source prices now belong in public.event_sources.';

comment on column public.events.availability_status is
  'LEGACY compatibility field. Observed source availability now belongs in public.event_sources.';

comment on column public.events.embedding is
  'LEGACY compatibility field. Search/recommendation projection now belongs in public.event_search.';
