import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyEventsBatch } from "../_shared/music-normalization-service.ts";

// ─── Env ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")              ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceConfig {
  type:        string;   // matches the Edge Function name: sync-{type}
  countryCode: string;
  market?:     string;   // Ticketmaster market (defaults to countryCode)
  url?:        string;   // for scraper-based sources
  enabled?:    boolean;  // default true — set false to pause without deleting
}

interface SyncResult {
  source:      string;
  country:     string;
  status:      "success" | "failed";
  inserted?:   number;
  updated?:    number;
  failed?:     number;
  skipped?:    number;
  error?:      string;
  diagnostics?: Record<string, unknown>;
  durationMs:  number;
}

interface OrchestratorResult {
  started_at:     string;
  finished_at:    string;
  results:        SyncResult[];
  total_inserted: number;
  total_failed:   number;
  normalization?: {
    attempted: boolean;
    error?: string;
    batch?: Awaited<ReturnType<typeof classifyEventsBatch>>;
  };
}

interface DispatchBody {
  countries?:     string[];
  sources?:       string[];
  syncRunId?:     string;
  force_refresh?: boolean;
}

const DEFAULT_COUNTRIES = ["PE"] as const;
const SOURCE_TIMEOUT_MS = 75_000;

// ─── Source registry ──────────────────────────────────────────────────────────
//
// To add a new country: add an entry here.
// To add a new scraper:
// 1. deploy `sync-{type}` from grub-workers to the same Supabase project
// 2. add a { type, countryCode, url } entry below
// The orchestrator lives in backend, but the scraper implementation belongs to
// workers and is invoked over HTTP via the shared project.

const SOURCES: Record<string, SourceConfig[]> = {
  PE: [
    { type: "ticketmaster-pe", countryCode: "PE", url: "https://www.ticketmaster.pe/page/categoria-conciertos" },
    { type: "teleticket",      countryCode: "PE", url: "https://teleticket.com.pe/conciertos" },
    { type: "joinnus",         countryCode: "PE", url: "https://www.joinnus.com/descubrir/concerts" },
    { type: "passline",        countryCode: "PE" },
    { type: "vastion",         countryCode: "PE", url: "https://www.vastiontickets.com/" },
    { type: "tikpe",           countryCode: "PE", url: "https://tik.pe/events" },
  ],
  MX: [
    { type: "ticketmaster", countryCode: "MX", market: "MX" },
    { type: "superboletos",  countryCode: "MX", url: "https://www.superboletos.com", enabled: false },
  ],
  AR: [
    { type: "ticketmaster", countryCode: "AR", market: "AR" },
  ],
  US: [
    { type: "ticketmaster", countryCode: "US", market: "US" },
  ],
  ES: [
    { type: "ticketmaster", countryCode: "ES", market: "ES" },
  ],
};

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Calls one Edge Function and returns a structured SyncResult.
 * Passes countryCode + market + url in the POST body so each function
 * can use whatever fields it needs.
 */
async function dispatch(cfg: SourceConfig, forceRefresh = false): Promise<SyncResult> {
  const fnUrl   = `${SUPABASE_URL}/functions/v1/sync-${cfg.type}`;
  const startMs = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(`timeout:${cfg.type}`), SOURCE_TIMEOUT_MS);

  console.log(`[sync-global] → ${cfg.type}/${cfg.countryCode} starting`);

  let raw: Response;
  try {
    raw = await fetch(fnUrl, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        countryCode:   cfg.countryCode,
        market:        cfg.market ?? cfg.countryCode,
        url:           cfg.url,
        force_refresh: forceRefresh,
        detailLimit:
          cfg.type === "passline" ? 100
          : cfg.type === "tikpe" ? 25
          : undefined,
      }),
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (controller.signal.aborted) {
      return {
        source:     cfg.type,
        country:    cfg.countryCode,
        status:     "failed",
        error:      `timeout after ${SOURCE_TIMEOUT_MS}ms`,
        durationMs: Date.now() - startMs,
      };
    }
    const durationMs = Date.now() - startMs;
    console.error(`[sync-global] ✗ ${cfg.type}/${cfg.countryCode} network error:`, err);
    return {
      source:     cfg.type,
      country:    cfg.countryCode,
      status:     "failed",
      error:      err instanceof Error ? err.message : String(err),
      durationMs,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startMs;

  if (!raw.ok) {
    const body = await raw.text().catch(() => "");
    console.error(`[sync-global] ✗ ${cfg.type}/${cfg.countryCode} HTTP ${raw.status}`);
    return {
      source:     cfg.type,
      country:    cfg.countryCode,
      status:     "failed",
      error:      `HTTP ${raw.status}: ${body.slice(0, 200)}`,
      durationMs,
    };
  }

  const json = await raw.json().catch(() => ({})) as Record<string, unknown>;

  console.log(
    `[sync-global] ✓ ${cfg.type}/${cfg.countryCode} done in ${durationMs}ms —`,
    `inserted=${Number(json.inserted ?? 0)} updated=${Number(json.updated ?? 0)} failed=${Number(json.failed ?? 0)} skipped=${Number(json.skipped ?? 0)}`,
  );

  return {
    source:     cfg.type,
    country:    cfg.countryCode,
    status:     "success",
    inserted:   Number(json.inserted ?? 0),
    updated:    Number(json.updated ?? 0),
    failed:     Number(json.failed ?? 0),
    skipped:    Number(json.skipped ?? 0),
    diagnostics: typeof json.diagnostics === "object" && json.diagnostics !== null
      ? json.diagnostics as Record<string, unknown>
      : undefined,
    durationMs,
  };
}

async function logSyncRunStart(body: DispatchBody): Promise<string | null> {
  const { data, error } = await supabase
    .schema("ingestion")
    .from("sync_runs")
    .insert({
      trigger_source: body.syncRunId ? "admin_api" : "sync_global",
      status: "running",
      country_codes: body.countries ?? null,
      source_filters: body.sources ?? null,
      summary: {},
    })
    .select("id")
    .single();

  if (error) {
    console.error("[sync-global] failed to create sync_runs row:", error.message);
    return null;
  }

  return data.id as string;
}

async function logSyncRunResults(runId: string | null, results: SyncResult[], totals: { inserted: number; failed: number; skipped: number }) {
  if (!runId) return;

  const itemRows = results.map((result) => ({
    sync_run_id: runId,
    source: result.source,
    country_code: result.country,
    status: result.status,
    inserted_count: result.inserted ?? 0,
    updated_count: result.updated ?? 0,
    failed_count: result.failed ?? 0,
    skipped_count: result.skipped ?? 0,
    duration_ms: result.durationMs,
    error_message: result.error ?? null,
    metadata: result.diagnostics ?? {},
    started_at: new Date(Date.now() - result.durationMs).toISOString(),
    finished_at: new Date().toISOString(),
  }));

  if (itemRows.length) {
    const { error: itemsError } = await supabase
      .schema("ingestion")
      .from("sync_run_items")
      .insert(itemRows);

    if (itemsError) {
      console.error("[sync-global] failed to insert sync_run_items:", itemsError.message);
    }
  }

  const hasFailed = results.some((result) => result.status === "failed");
  const hasSuccess = results.some((result) => result.status === "success");
  const status = hasFailed && hasSuccess ? "partial" : hasFailed ? "failed" : "success";

  const { error: runError } = await supabase
    .schema("ingestion")
    .from("sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      summary: {
        total_inserted: totals.inserted,
        total_failed: totals.failed,
        total_skipped: totals.skipped,
        total_sources: results.length,
      },
    })
    .eq("id", runId);

  if (runError) {
    console.error("[sync-global] failed to update sync_runs:", runError.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(body: DispatchBody): Promise<OrchestratorResult> {
  const startedAt = new Date().toISOString();
  const runId = body.syncRunId ?? await logSyncRunStart(body);

  // Resolve which countries to process
  const targetCountries = body.countries?.length
    ? body.countries.map((c) => c.toUpperCase())
    : [...DEFAULT_COUNTRIES];

  // Resolve which source types to process (optional filter)
  const targetSources = body.sources?.map((s) => s.toLowerCase());

  // Build flat list of enabled configs to run
  const configs: SourceConfig[] = targetCountries.flatMap((cc) => {
    const srcs = SOURCES[cc] ?? [];
    return srcs.filter((cfg) => {
      if (cfg.enabled === false) return false;
      if (targetSources && !targetSources.includes(cfg.type)) return false;
      return true;
    });
  });

  console.log(
    `[sync-global] running ${configs.length} source(s) across`,
    `${targetCountries.join(", ")}`,
  );

  // Group by country so all sources for the same country run in parallel,
  // but different countries also run in parallel via Promise.allSettled.
  const byCountry = new Map<string, SourceConfig[]>();
  for (const cfg of configs) {
    const list = byCountry.get(cfg.countryCode) ?? [];
    list.push(cfg);
    byCountry.set(cfg.countryCode, list);
  }

  const forceRefresh = body.force_refresh === true;
  const countryJobs = [...byCountry.values()].map((cfgs) =>
    Promise.allSettled(cfgs.map((cfg) => dispatch(cfg, forceRefresh)))
  );

  const settled = await Promise.allSettled(countryJobs);

  // Flatten results
  const results: SyncResult[] = [];
  for (const outer of settled) {
    if (outer.status === "rejected") continue; // shouldn't happen (allSettled)
    for (const inner of outer.value) {
      results.push(
        inner.status === "fulfilled"
          ? inner.value
          : {
              source:     "unknown",
              country:    "unknown",
              status:     "failed",
              error:      String(inner.reason),
              durationMs: 0,
            },
      );
    }
  }

  const total_inserted = results.reduce((s, r) => s + (r.inserted ?? 0), 0);
  const total_failed   = results.filter((r) => r.status === "failed").length;
  const total_skipped  = results.reduce((s, r) => s + (r.skipped ?? 0), 0);

  await logSyncRunResults(runId, results, {
    inserted: total_inserted,
    failed: total_failed,
    skipped: total_skipped,
  });

  let normalization: OrchestratorResult["normalization"] | undefined;
  if (total_inserted > 0) {
    try {
      const batch = await classifyEventsBatch(supabase, {
        limit: Math.min(Math.max(total_inserted * 2, 25), 100),
        only_without_genres: true,
        dry_run: false,
      });
      normalization = {
        attempted: true,
        batch,
      };
    } catch (error) {
      console.error("[sync-global] normalization follow-up failed", error);
      normalization = {
        attempted: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Artist enrichment (fire-and-forget: no bloquea el resultado del sync) ──
  // Se dispara solo cuando hay eventos nuevos. Procesa hasta 20 artistas
  // pendientes en background para no alargar el timeout del cron.
  if (total_inserted > 0) {
    const enrichUrl = `${SUPABASE_URL}/functions/v1/enrich-artists`;
    fetch(enrichUrl, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ limit: 20 }),
    }).catch((err) => {
      console.warn("[sync-global] enrich-artists fire-and-forget failed:", err);
    });
    console.log("[sync-global] enrich-artists dispatched (limit=20, fire-and-forget)");
  }

  return {
    started_at:  startedAt,
    finished_at: new Date().toISOString(),
    results,
    total_inserted,
    total_failed,
    normalization,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status:  405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body: DispatchBody = await req.json().catch(() => ({}));

    // ── Auth check ──────────────────────────────────────────────────────────────
    const cronSecret = Deno.env.get("CRON_SECRET");
    const auth = req.headers.get("Authorization") ?? "";
    const allowedTokens = [
      cronSecret ? `Bearer ${cronSecret}` : null,
      SUPABASE_SERVICE_ROLE_KEY ? `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` : null,
    ].filter((value): value is string => Boolean(value));

    if (allowedTokens.length > 0 && !allowedTokens.includes(auth)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await run(body);
    return new Response(JSON.stringify(result, null, 2), {
      status:  200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[sync-global]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status:  500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// ─── DEPLOY ───────────────────────────────────────────────────────────────────
//
// supabase functions deploy sync-global --no-verify-jwt
//
// VARIABLES DE ENTORNO: ninguna adicional.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son inyectadas automáticamente.
//
// CRON DIARIO (SQL Editor — requiere pg_cron + pg_net):
//
//   SELECT cron.schedule(
//     'sync-global-daily',
//     '0 3 * * *',   -- 3am UTC
//     $$
//     SELECT net.http_post(
//       url     := current_setting('app.supabase_url') || '/functions/v1/sync-global',
//       headers := jsonb_build_object(
//         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
//         'Content-Type',  'application/json'
//       ),
//       body := '{}'::jsonb
//     )
//     $$
//   );
//
// CURL — solo Perú:
//   curl -X POST https://xmdoaikmmhdzdzxovwzn.supabase.co/functions/v1/sync-global \
//     -H "Authorization: Bearer TU_ANON_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"countries": ["PE"]}'
//
// CURL — solo México:
//   curl -X POST https://xmdoaikmmhdzdzxovwzn.supabase.co/functions/v1/sync-global \
//     -H "Authorization: Bearer TU_ANON_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"countries": ["MX"]}'
//
// CURL — solo ticketmaster en todos los países:
//   curl -X POST https://xmdoaikmmhdzdzxovwzn.supabase.co/functions/v1/sync-global \
//     -H "Authorization: Bearer TU_ANON_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"sources": ["ticketmaster"]}'
//
// AGREGAR UN PAÍS NUEVO:
//   1. Añadir entrada en SOURCES arriba
//   2. Si es un scraper nuevo: crear supabase/functions/sync-{type}/index.ts
//      con handler POST que retorne { inserted, updated, failed }
//   3. No hace falta tocar este archivo
