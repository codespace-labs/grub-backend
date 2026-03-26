import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { user, role } = await requireAdmin(req, "operator");
    const body = await req.json().catch(() => ({}));
    const source = typeof body.source === "string" && body.source.trim().length > 0
      ? body.source.trim()
      : null;
    const countries = body.countries ?? ["PE"];
    const forceRefresh = body.force_refresh === true;

    const supabase = createServiceClient();
    const { data: run, error: runError } = await supabase
      .schema("ingestion")
      .from("sync_runs")
      .insert({
        trigger_source: "admin_api",
        status: "running",
        country_codes: countries,
        source_filters: source ? [source] : null,
        triggered_by: user.id,
        summary: { requested_source: source ?? "global" },
      })
      .select("id")
      .single();

    if (runError) {
      console.error("[api-admin-source-sync] sync_runs insert failed", runError);
    }

    const runId = run?.id ?? null;

    const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-global`;
    const dispatch = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("CRON_SECRET")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sources: source ? [source] : undefined,
        countries,
        syncRunId: runId ?? undefined,
        force_refresh: forceRefresh,
      }),
    });

    const payload = await dispatch.json().catch(() => ({}));

    if (runId && !dispatch.ok) {
      const { error: updateError } = await supabase
        .schema("ingestion")
        .from("sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          summary: { requested_source: source ?? "global", response: payload, wrapper_error: true },
        })
        .eq("id", runId);

      if (updateError) {
        console.error("[api-admin-source-sync] sync_runs update failed", updateError);
      }
    }

    const { error: auditError } = await supabase.schema("admin").from("audit_logs").insert({
      actor_user_id: user.id,
      actor_role: role,
      action: "source.sync",
      entity_type: "sync_run",
      entity_id: runId,
      payload: { source: source ?? "global", countries, response: payload },
    });

    if (auditError) {
      console.error("[api-admin-source-sync] audit_logs insert failed", auditError);
    }

    return jsonResponse(
      {
        sync_run_id: runId,
        response: payload,
      },
      dispatch.ok ? 200 : 500,
    );
  } catch (error) {
    console.error("[api-admin-source-sync]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
