create table if not exists normalization.ai_event_enrichments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  provider text not null,
  model text not null,
  status text not null default 'pending',
  confidence numeric(5,4) null,
  review_required boolean not null default false,
  input_payload jsonb not null default '{}'::jsonb,
  proposed_patch jsonb null,
  applied_patch jsonb null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null,
  constraint ai_event_enrichments_status_check
    check (status in ('pending', 'applied', 'review', 'skipped', 'failed'))
);

create index if not exists normalization_ai_event_enrichments_event_idx
  on normalization.ai_event_enrichments (event_id, created_at desc);

create index if not exists normalization_ai_event_enrichments_status_idx
  on normalization.ai_event_enrichments (status, created_at desc);

comment on table normalization.ai_event_enrichments is
  'Historial de propuestas de enriquecimiento asistidas por IA para eventos scrapeados.';
