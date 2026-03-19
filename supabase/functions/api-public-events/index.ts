import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const source = url.searchParams.get("source");
    const city = url.searchParams.get("city");
    const genre = url.searchParams.get("genre");
    const limit = Number(url.searchParams.get("limit") ?? "50");

    const supabase = createServiceClient();
    let query = supabase
      .from("events")
      .select(`
        id, name, date, cover_url, price_min, price_max, venue, city, country_code,
        availability_status, source, ticket_url,
        event_genres ( genres ( slug, name ) )
      `)
      .eq("is_active", true)
      .gte("date", new Date().toISOString())
      .order("date", { ascending: true })
      .limit(limit);

    if (source) query = query.eq("source", source);
    if (city) query = query.eq("city", city);
    if (genre) query = query.filter("event_genres.genres.slug", "eq", genre);

    const { data, error } = await query;
    if (error) throw error;

    return jsonResponse({ events: data ?? [] });
  } catch (error) {
    console.error("[api-public-events]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
