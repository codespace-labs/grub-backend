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
    const source = body.source;
    const countries = body.countries ?? ["PE"];

    if (!source) return jsonResponse({ error: "Missing source" }, 400);

    const supabase = createServiceClient();
    const { data: run, error: runError } = await supabase
      .schema("ingestion")
      .from("sync_runs")
      .insert({
        trigger_source: "admin_api",
        status: "running",
        country_codes: countries,
        source_filters: [source],
        triggered_by: user.id,
        summary: { requested_source: source },
      })
      .select("id")
      .single();

    if (runError) throw runError;

    const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-global`;
    const dispatch = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sources: [source], countries }),
    });

    const payload = await dispatch.json().catch(() => ({}));

    await supabase.schema("admin").from("audit_logs").insert({
      actor_user_id: user.id,
      actor_role: role,
      action: "source.sync",
      entity_type: "sync_run",
      entity_id: run.id,
      payload: { source, countries, response: payload },
    });

    return jsonResponse({ sync_run_id: run.id, response: payload }, dispatch.ok ? 200 : 500);
  } catch (error) {
    console.error("[api-admin-source-sync]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
