# grub-backend

Fuente real de backend en esta fase.

Mapa del sistema:
- ver [SYSTEM_MAP.md](./SYSTEM_MAP.md) para entender tablas, fuentes de verdad, Edge Functions, scrapers, normalización y flujo end-to-end.

Incluye:
- migraciones
- funciones públicas
- funciones admin
- funciones de sync/workers por compatibilidad de despliegue

Comandos típicos:
- supabase start
- supabase db reset
- supabase functions serve --no-verify-jwt
- supabase functions deploy api-admin-events --no-verify-jwt --project-ref <project-ref>

Auth de Edge Functions:
- Las functions `api-admin-*` usan auth interna con `requireAdmin()` en `supabase/functions/_shared/admin-auth.ts`.
- Por esa razón deben desplegarse con `--no-verify-jwt`, para evitar doble validación:
  - la gateway de Supabase Functions valida el JWT
  - y luego la function vuelve a validar usuario y rol (`viewer`, `operator`, `admin`, `superadmin`)
- Si se despliegan sin `--no-verify-jwt`, puede aparecer un falso `401 Invalid JWT` en la gateway aun cuando `/auth/v1/user` acepta el mismo access token.
- Las functions públicas o internas que no usan `requireAdmin()` pueden seguir otra estrategia, pero las `api-admin-*` del backoffice deben mantenerse consistentes con este patrón.

Normalizacion musical MVP:
- migracion base en `supabase/migrations/20260319193000_create_normalization_foundation.sql`
- endpoint interno en `supabase/functions/api-internal-normalization`
- auth interna por `x-grub-internal-key`, service role o JWT admin/operator/viewer
- Discogs puede autenticarse con `DISCOGS_USER_TOKEN` o con `DISCOGS_CONSUMER_KEY` + `DISCOGS_CONSUMER_SECRET`

Enriquecimiento IA de eventos:
- migración de auditoría en `supabase/migrations/20260326190000_create_ai_event_enrichment_runs.sql`
- servicio compartido en `supabase/functions/_shared/ai-event-enrichment.ts`
- acción admin/interna: `ai_enrich_events_batch`
- variables requeridas:
  - `AI_ENRICHMENT_API_URL`
  - `AI_ENRICHMENT_API_KEY`
  - `AI_ENRICHMENT_MODEL`
  - opcional: `AI_ENRICHMENT_PROVIDER`
- para Grok/xAI:
  - `AI_ENRICHMENT_PROVIDER=xai`
  - `XAI_API_KEY=<tu_api_key>`
  - `XAI_MODEL=<modelo_grok>`
  - opcional: `XAI_API_URL=https://api.x.ai/v1/chat/completions`
- ejemplo de invocación:
  - `POST /functions/v1/api-admin-normalization`
  - body: `{"action":"ai_enrich_events_batch","ai_options":{"limit":10,"dry_run":true}}`
