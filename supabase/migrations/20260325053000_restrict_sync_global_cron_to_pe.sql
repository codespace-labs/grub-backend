-- Restrict the automatic sync-global cron to Peru only.
-- The orchestrator now defaults to PE in code, but we also make the scheduled
-- body explicit so the behavior is visible from pg_cron and survives future edits.

select cron.unschedule('sync-global-daily') where exists (
  select 1 from cron.job where jobname = 'sync-global-daily'
);

select cron.schedule(
  'sync-global-daily',
  '0 3 * * *',
  $$
  select net.http_post(
    url     := 'https://xmdoaikmmhdzdzxovwzn.supabase.co/functions/v1/sync-global',
    headers := '{"Authorization": "Bearer f4292274b15611ff79260fcbbca9712df8cc136236ec55dd4fb78192ada1c300", "Content-Type": "application/json"}'::jsonb,
    body    := '{"countries":["PE"]}'::jsonb
  )
  $$
);
