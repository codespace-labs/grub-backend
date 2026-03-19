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

    await supabase.rpc("refresh_quality_issues");

    const { data, error } = await supabase
      .schema("quality")
      .from("quality_issues")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(200);

    if (error) throw error;
    return jsonResponse({ issues: data ?? [] });
  } catch (error) {
    console.error("[api-admin-quality-issues]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
