create extension if not exists pgcrypto;
create extension if not exists unaccent;

create schema if not exists ingestion;
create schema if not exists quality;
create schema if not exists admin;

create table if not exists ingestion.sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null default 'manual',
  status text not null default 'running',
  country_codes text[] null,
  source_filters text[] null,
  triggered_by uuid null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sync_runs_status_check check (status in ('running', 'success', 'failed', 'partial'))
);

create table if not exists ingestion.sync_run_items (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references ingestion.sync_runs(id) on delete cascade,
  source text not null,
  country_code text not null,
  status text not null,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  duration_ms integer not null default 0,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint sync_run_items_status_check check (status in ('success', 'failed'))
);

create index if not exists sync_runs_started_at_idx
  on ingestion.sync_runs (started_at desc);

create index if not exists sync_run_items_sync_run_id_idx
  on ingestion.sync_run_items (sync_run_id);

create table if not exists admin.manual_event_overrides (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  field_name text not null,
  previous_value jsonb null,
  new_value jsonb not null,
  reason text null,
  status text not null default 'applied',
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint manual_event_overrides_status_check check (status in ('applied', 'reverted'))
);

create index if not exists manual_event_overrides_event_id_idx
  on admin.manual_event_overrides (event_id, created_at desc);

create table if not exists admin.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null,
  actor_role text null,
  action text not null,
  entity_type text not null,
  entity_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx
  on admin.audit_logs (entity_type, entity_id, created_at desc);

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    'viewer'
  );
$$;

create or replace view quality.event_quality_issues as
with genre_issues as (
  select
    ev.id as event_id,
    ev.source,
    'genre_validation'::text as issue_type,
    ev.validation_status as issue_code,
    ev.name as title,
    jsonb_build_object(
      'assigned_genres', ev.assigned_genres,
      'inferred_genres', ev.inferred_genres,
      'artist_genres', ev.artist_genres
    ) as detail
  from public.event_genre_validation ev
  where ev.validation_status is not null
),
missing_venue as (
  select
    e.id as event_id,
    e.source,
    'location'::text as issue_type,
    'missing_visible_venue'::text as issue_code,
    e.name as title,
    jsonb_build_object(
      'venue', e.venue,
      'city', e.city,
      'country_code', e.country_code
    ) as detail
  from public.events e
  where e.is_active = true
    and (
      e.venue is null
      or btrim(e.venue) = ''
      or lower(btrim(e.venue)) in ('por anunciar', '-')
    )
),
title_city_leak as (
  select
    e.id as event_id,
    e.source,
    'location'::text as issue_type,
    'title_contains_city'::text as issue_code,
    e.name as title,
    jsonb_build_object(
      'name', e.name,
      'city', e.city
    ) as detail
  from public.events e
  where e.is_active = true
    and e.city is not null
    and (
      regexp_replace(lower(unaccent(e.name)), '[^a-z0-9]+', ' ', 'g')
        like ('% ' || regexp_replace(lower(unaccent(e.city)), '[^a-z0-9]+', ' ', 'g'))
      or regexp_replace(lower(unaccent(e.name)), '[^a-z0-9]+', ' ', 'g')
        like ('% en ' || regexp_replace(lower(unaccent(e.city)), '[^a-z0-9]+', ' ', 'g'))
    )
)
select * from genre_issues
union all
select * from missing_venue
union all
select * from title_city_leak;

create table if not exists quality.quality_issues (
  id uuid primary key default gen_random_uuid(),
  issue_type text not null,
  issue_code text not null,
  entity_type text not null default 'event',
  entity_id uuid not null,
  source text null,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null,
  created_at timestamptz not null default now(),
  constraint quality_issues_status_check check (status in ('open', 'ignored', 'resolved')),
  constraint quality_issues_unique_open unique (issue_type, issue_code, entity_id, status)
);

create index if not exists quality_issues_status_idx
  on quality.quality_issues (status, detected_at desc);

create or replace function quality.refresh_quality_issues()
returns bigint
language plpgsql
as $$
declare
  inserted_count bigint;
begin
  insert into quality.quality_issues (
    issue_type,
    issue_code,
    entity_id,
    source,
    title,
    detail,
    status
  )
  select
    q.issue_type,
    q.issue_code,
    q.event_id,
    q.source,
    q.title,
    q.detail,
    'open'
  from quality.event_quality_issues q
  left join quality.quality_issues existing
    on existing.entity_id = q.event_id
   and existing.issue_type = q.issue_type
   and existing.issue_code = q.issue_code
   and existing.status = 'open'
  where existing.id is null
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  update quality.quality_issues qi
  set
    status = 'resolved',
    resolved_at = now()
  where qi.status = 'open'
    and not exists (
      select 1
      from quality.event_quality_issues current_issue
      where current_issue.event_id = qi.entity_id
        and current_issue.issue_type = qi.issue_type
        and current_issue.issue_code = qi.issue_code
    );

  return inserted_count;
end;
$$;

create or replace function public.refresh_quality_issues()
returns bigint
language sql
security definer
as $$
  select quality.refresh_quality_issues();
$$;
