-- Ajusta los jobs recién creados para que respeten hora Perú/Bogotá (UTC-5)
-- sobre un scheduler en UTC.
--
-- Hora local deseada -> expresión UTC real:
-- 03:00 -> 08:00 UTC
-- 03:30 -> 08:30 UTC
-- 11:00 -> 16:00 UTC
-- 11:30 -> 16:30 UTC

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('sync-global-pe-full-0300')
  where exists (
    select 1 from cron.job where jobname = 'sync-global-pe-full-0300'
  );

  perform cron.unschedule('normalize-events-pe-0330')
  where exists (
    select 1 from cron.job where jobname = 'normalize-events-pe-0330'
  );

  perform cron.unschedule('sync-global-pe-incremental-1100')
  where exists (
    select 1 from cron.job where jobname = 'sync-global-pe-incremental-1100'
  );

  perform cron.unschedule('normalize-events-pe-1130')
  where exists (
    select 1 from cron.job where jobname = 'normalize-events-pe-1130'
  );

  perform cron.schedule(
    'sync-global-pe-full-0300',
    '0 8 * * *',
    $job$
    select net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/sync-global',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{
        "countries":["PE"],
        "sources":["ticketmaster-pe","teleticket","joinnus","passline","vastion","tikpe"]
      }'::jsonb
    )
    $job$
  );

  perform cron.schedule(
    'normalize-events-pe-0330',
    '30 8 * * *',
    $job$
    select net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/api-internal-normalization',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{
        "action":"classify_events_batch",
        "options":{"limit":150,"only_without_genres":true}
      }'::jsonb
    )
    $job$
  );

  perform cron.schedule(
    'sync-global-pe-incremental-1100',
    '0 16 * * *',
    $job$
    select net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/sync-global',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{
        "countries":["PE"],
        "sources":["joinnus","vastion","tikpe"]
      }'::jsonb
    )
    $job$
  );

  perform cron.schedule(
    'normalize-events-pe-1130',
    '30 16 * * *',
    $job$
    select net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/api-internal-normalization',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{
        "action":"classify_events_batch",
        "options":{"limit":150,"only_without_genres":true}
      }'::jsonb
    )
    $job$
  );
end
$$;
