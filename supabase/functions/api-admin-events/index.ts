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

    const url = new URL(req.url);
    const source = url.searchParams.get("source");
    const status = url.searchParams.get("status");
    const limit = Number(url.searchParams.get("limit") ?? "100");

    const supabase = createServiceClient();
    let query = supabase
      .from("events")
      .select(`
        id, name, date, start_time, venue, city, country_code,
        ticket_url, cover_url, price_min, price_max,
        availability_status, source, is_active
      `)
      .order("date", { ascending: true })
      .limit(limit);

    if (source) query = query.eq("source", source);
    if (status === "active") query = query.eq("is_active", true);
    if (status === "inactive") query = query.eq("is_active", false);

    const { data, error } = await query;
    if (error) throw error;

    return jsonResponse({ events: data ?? [] });
  } catch (error) {
    console.error("[api-admin-events]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
