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
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "24"), 60);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
    const genreIdsParam = url.searchParams.get("genre_ids");
    const genreIds = genreIdsParam
      ? genreIdsParam.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];

    const supabase = createServiceClient();

    let query = supabase
      .from("artists")
      .select(`
        id,
        name,
        slug,
        photo_url,
        artist_genres (
          genres (
            id,
            slug,
            name
          )
        )
      `)
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (genreIds.length > 0) {
      // Filter artists that have at least one of the requested genres
      const { data: artistIdRows, error: filterError } = await supabase
        .from("artist_genres")
        .select("artist_id")
        .in("genre_id", genreIds);

      if (filterError) throw filterError;

      const matchingIds = [...new Set((artistIdRows ?? []).map((r) => r.artist_id))];
      if (matchingIds.length === 0) {
        return jsonResponse({ artists: [] });
      }

      query = query.in("id", matchingIds);
    }

    const { data, error } = await query;

    if (error) throw error;

    const artists = (data ?? []).map((artist) => ({
      id: artist.id,
      name: artist.name,
      slug: artist.slug,
      photo_url: artist.photo_url,
      genres: (artist.artist_genres ?? [])
        .map((row) => row.genres)
        .filter(Boolean),
    }));

    return jsonResponse({ artists });
  } catch (error) {
    console.error("[api-public-artists]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
