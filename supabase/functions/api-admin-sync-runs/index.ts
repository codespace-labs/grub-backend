import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    await requireAdmin(req, "viewer");
    const supabase = createServiceClient();

    const { data: runs, error: runsError } = await supabase
      .schema("ingestion")
      .from("sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);

    if (runsError) throw runsError;

    const runIds = (runs ?? []).map((run) => run.id);
    const { data: items, error: itemsError } = runIds.length
      ? await supabase
          .schema("ingestion")
          .from("sync_run_items")
          .select("*")
          .in("sync_run_id", runIds)
          .order("started_at", { ascending: false })
      : { data: [], error: null };

    if (itemsError) throw itemsError;

    const itemsByRunId = new Map<string, unknown[]>();
    for (const item of items ?? []) {
      const bucket = itemsByRunId.get(item.sync_run_id) ?? [];
      bucket.push(item);
      itemsByRunId.set(item.sync_run_id, bucket);
    }

    return jsonResponse({
      runs: (runs ?? []).map((run) => ({
        ...run,
        items: itemsByRunId.get(run.id) ?? [],
      })),
    });
  } catch (error) {
    console.error("[api-admin-sync-runs]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
