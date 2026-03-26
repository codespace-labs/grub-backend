create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.auth_verification_attempts (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text null,
  phone_e164 text not null,
  provider text not null default 'clerk',
  channel text not null default 'sms',
  purpose text not null,
  status text not null,
  attempt_sequence integer not null default 1,
  error_code text null,
  error_message text null,
  clerk_request_id text null,
  ip inet null,
  user_agent text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz null,
  constraint auth_verification_attempts_provider_check
    check (provider in ('clerk', 'supabase', 'twilio', 'custom')),
  constraint auth_verification_attempts_channel_check
    check (channel in ('sms', 'whatsapp', 'voice')),
  constraint auth_verification_attempts_status_check
    check (
      status in (
        'requested',
        'code_sent',
        'verify_requested',
        'verified',
        'failed',
        'expired',
        'rate_limited',
        'blocked'
      )
    ),
  constraint auth_verification_attempts_phone_e164_check
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint auth_verification_attempts_attempt_sequence_check
    check (attempt_sequence >= 1)
);

create index if not exists auth_verification_attempts_phone_purpose_created_idx
  on public.auth_verification_attempts (phone_e164, purpose, created_at desc);

create index if not exists auth_verification_attempts_phone_purpose_sequence_idx
  on public.auth_verification_attempts (phone_e164, purpose, attempt_sequence desc);

create index if not exists auth_verification_attempts_status_created_idx
  on public.auth_verification_attempts (status, created_at desc);

create index if not exists auth_verification_attempts_clerk_user_created_idx
  on public.auth_verification_attempts (clerk_user_id, created_at desc);

create index if not exists auth_verification_attempts_clerk_request_idx
  on public.auth_verification_attempts (clerk_request_id);

create index if not exists auth_verification_attempts_verified_at_idx
  on public.auth_verification_attempts (verified_at desc nulls last);

create index if not exists auth_verification_attempts_metadata_gin_idx
  on public.auth_verification_attempts
  using gin (metadata);

drop trigger if exists auth_verification_attempts_set_updated_at
  on public.auth_verification_attempts;

create trigger auth_verification_attempts_set_updated_at
before update on public.auth_verification_attempts
for each row
execute function public.set_updated_at();

alter table public.auth_verification_attempts enable row level security;

revoke all on public.auth_verification_attempts from anon, authenticated;
grant all on public.auth_verification_attempts to service_role;

drop policy if exists "service role can manage auth verification attempts"
  on public.auth_verification_attempts;

create policy "service role can manage auth verification attempts"
on public.auth_verification_attempts
for all
to service_role
using (true)
with check (true);
