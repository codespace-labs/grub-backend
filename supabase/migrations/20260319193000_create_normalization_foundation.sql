create schema if not exists normalization;

create table if not exists normalization.raw_inputs (
  id uuid primary key default gen_random_uuid(),
  source_platform text not null,
  entity_type text not null default 'artist',
  external_id text null,
  source_url text null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists normalization_raw_inputs_platform_idx
  on normalization.raw_inputs (source_platform, created_at desc);

create index if not exists normalization_raw_inputs_hash_idx
  on normalization.raw_inputs (payload_hash);

create table if not exists normalization.artist_aliases (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text not null default 'manual',
  is_official boolean not null default false,
  confidence numeric(5,4) not null default 0.7000,
  created_at timestamptz not null default now()
);

create index if not exists normalization_artist_aliases_artist_idx
  on normalization.artist_aliases (artist_id);

create index if not exists normalization_artist_aliases_lookup_idx
  on normalization.artist_aliases (normalized_alias);

create unique index if not exists normalization_artist_aliases_unique_idx
  on normalization.artist_aliases (artist_id, normalized_alias);

create table if not exists normalization.genre_synonyms (
  id uuid primary key default gen_random_uuid(),
  raw_value text not null,
  normalized_value text not null,
  genre_id bigint not null references public.genres(id) on delete cascade,
  canonical_subgenre_slug text null,
  canonical_subgenre_name text null,
  source text not null default 'seed',
  confidence numeric(5,4) not null default 0.8000,
  created_at timestamptz not null default now()
);

create unique index if not exists normalization_genre_synonyms_unique_idx
  on normalization.genre_synonyms (normalized_value, genre_id, coalesce(canonical_subgenre_slug, ''));

create index if not exists normalization_genre_synonyms_lookup_idx
  on normalization.genre_synonyms (normalized_value);

insert into normalization.genre_synonyms (
  raw_value,
  normalized_value,
  genre_id,
  source,
  confidence
)
select
  g.slug,
  lower(trim(g.slug)),
  g.id,
  'bootstrap',
  1.0000
from public.genres g
on conflict do nothing;

insert into normalization.genre_synonyms (
  raw_value,
  normalized_value,
  genre_id,
  source,
  confidence
)
select
  g.name,
  lower(trim(g.name)),
  g.id,
  'bootstrap',
  0.9500
from public.genres g
on conflict do nothing;

create table if not exists normalization.cache_entries (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  entity_type text not null,
  input_hash text not null,
  input_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) not null default 0.0000,
  status text not null default 'matched',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint normalization_cache_status_check
    check (status in ('matched', 'matched_low_confidence', 'ambiguous', 'unresolved'))
);

create index if not exists normalization_cache_entity_expiry_idx
  on normalization.cache_entries (entity_type, expires_at desc);

create table if not exists normalization.runs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  action text not null default 'normalize',
  cache_key text null,
  input_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb null,
  status text not null default 'running',
  confidence numeric(5,4) null,
  review_required boolean not null default false,
  sources_used text[] not null default '{}',
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null,
  constraint normalization_runs_status_check
    check (status in ('running', 'matched', 'matched_low_confidence', 'ambiguous', 'unresolved', 'failed'))
);

create index if not exists normalization_runs_status_idx
  on normalization.runs (status, created_at desc);

create table if not exists normalization.evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references normalization.runs(id) on delete cascade,
  provider text not null,
  used_for text not null,
  provider_entity_id text null,
  score numeric(5,4) not null default 0.0000,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists normalization_evidence_run_idx
  on normalization.evidence (run_id, provider);

create table if not exists normalization.review_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references normalization.runs(id) on delete cascade,
  entity_type text not null,
  reason_code text not null,
  payload jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  constraint normalization_review_queue_status_check
    check (status in ('open', 'resolved', 'ignored'))
);

create index if not exists normalization_review_queue_status_idx
  on normalization.review_queue (status, priority asc, created_at asc);

create table if not exists normalization.event_classifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  primary_genre_id bigint null references public.genres(id) on delete set null,
  primary_subgenre_slug text null,
  primary_subgenre_name text null,
  confidence numeric(5,4) not null default 0.0000,
  derived_from_artist_ids uuid[] not null default '{}',
  normalization_run_id uuid not null references normalization.runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id)
);

create index if not exists normalization_event_classifications_genre_idx
  on normalization.event_classifications (primary_genre_id, created_at desc);
