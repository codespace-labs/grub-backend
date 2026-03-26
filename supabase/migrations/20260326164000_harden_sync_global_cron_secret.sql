-- Reprograma el cron de sync-global para usar el service role dinámico provisto
-- por Supabase en la base, en vez de dejar un bearer token hardcodeado en SQL.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  job_command text;
begin
  perform cron.unschedule('sync-global-daily')
  where exists (
    select 1
    from cron.job
    where jobname = 'sync-global-daily'
  );

  job_command := $job$
    select net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/sync-global',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{"countries":["PE"]}'::jsonb
    )
  $job$;

  perform cron.schedule(
    'sync-global-daily',
    '0 3 * * *',
    job_command
  );
end
$$;
