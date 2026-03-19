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
    const featuredLimit = Number(url.searchParams.get("featured_limit") ?? "10");
    const listedLimit = Number(url.searchParams.get("listed_limit") ?? "20");

    const supabase = createServiceClient();

    const featuredQuery = supabase
      .from("events")
      .select(`
        id, name, date, cover_url, price_min, venue, city, country_code,
        event_genres ( genres ( slug, name ) )
      `)
      .eq("is_active", true)
      .gte("date", new Date().toISOString())
      .order("date", { ascending: true })
      .limit(featuredLimit);

    const listedQuery = supabase
      .from("events")
      .select(`
        id, name, date, cover_url, price_min, venue, city, country_code,
        event_genres ( genres ( slug, name ) )
      `)
      .eq("is_active", true)
      .gte("date", new Date().toISOString())
      .order("date", { ascending: true })
      .limit(listedLimit);

    const genresQuery = supabase
      .from("genres")
      .select("id, slug, name")
      .order("name", { ascending: true });

    const [featuredResult, listedResult, genresResult] = await Promise.all([
      featuredQuery,
      listedQuery,
      genresQuery,
    ]);

    if (featuredResult.error) throw featuredResult.error;
    if (listedResult.error) throw listedResult.error;
    if (genresResult.error) throw genresResult.error;

    return jsonResponse({
      featured: featuredResult.data ?? [],
      listed: listedResult.data ?? [],
      genres: genresResult.data ?? [],
    });
  } catch (error) {
    console.error("[api-public-feed-home]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
