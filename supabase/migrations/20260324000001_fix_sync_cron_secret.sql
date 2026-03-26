-- Corrige el cron job para usar CRON_SECRET en lugar de service role key.
-- sync-global requiere CRON_SECRET en el header Authorization.

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
    body    := '{}'::jsonb
  )
  $$
);
