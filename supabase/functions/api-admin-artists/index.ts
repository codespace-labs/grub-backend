import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type ArtistPayload = {
  name?: string;
  slug?: string;
  photo_url?: string | null;
  musicbrainz_id?: string | null;
  genre_ids?: number[];
};

function getArtistIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const apiIndex = parts.findIndex((part) => part === "api-admin-artists");
  if (apiIndex === -1) return null;
  return parts[apiIndex + 1] ?? null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeArtistPayload(payload: ArtistPayload): {
  artist: Record<string, unknown>;
  genreIds: number[];
} {
  const name = normalizeString(payload.name);
  const slug = normalizeString(payload.slug);
  const genreIds = Array.isArray(payload.genre_ids)
    ? payload.genre_ids.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];

  return {
    artist: Object.fromEntries(
      Object.entries({
        name,
        slug: slug ? slugify(slug) : name ? slugify(name) : undefined,
        photo_url: payload.photo_url === undefined ? undefined : normalizeString(payload.photo_url),
        musicbrainz_id: payload.musicbrainz_id === undefined ? undefined : normalizeString(payload.musicbrainz_id),
      }).filter(([, value]) => value !== undefined),
    ),
    genreIds,
  };
}

async function replaceArtistGenres(
  supabase: ReturnType<typeof createServiceClient>,
  artistId: string,
  genreIds: number[],
) {
  const { error: deleteError } = await supabase
    .from("artist_genres")
    .delete()
    .eq("artist_id", artistId);

  if (deleteError) throw deleteError;

  if (!genreIds.length) return;

  const { error: insertError } = await supabase
    .from("artist_genres")
    .insert(genreIds.map((genreId) => ({ artist_id: artistId, genre_id: genreId })));

  if (insertError) throw insertError;
}

async function fetchArtists(supabase: ReturnType<typeof createServiceClient>) {
  const { data, error } = await supabase
    .from("artists")
    .select(`
      id,
      name,
      slug,
      photo_url,
      musicbrainz_id,
      artist_genres (
        genre_id,
        genres (
          id,
          slug,
          name
        )
      )
    `)
    .order("name", { ascending: true });

  if (error) throw error;

  const artists = (data ?? []).map((artist) => ({
    id: artist.id,
    name: artist.name,
    slug: artist.slug,
    photo_url: artist.photo_url,
    musicbrainz_id: artist.musicbrainz_id,
    genres: (artist.artist_genres ?? [])
      .map((row) => row.genres)
      .filter(Boolean),
  }));

  return artists;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const artistId = getArtistIdFromPath(url.pathname);

    if (req.method === "GET") {
      await requireAdmin(req, "viewer");
      const supabase = createServiceClient();
      const artists = await fetchArtists(supabase);
      return jsonResponse({ artists });
    }

    await requireAdmin(req, "operator");
    const supabase = createServiceClient();

    if (req.method === "DELETE") {
      if (!artistId) {
        return jsonResponse({ error: "Missing artist id" }, 400);
      }

      const { error: eventArtistsError } = await supabase
        .from("event_artists")
        .delete()
        .eq("artist_id", artistId);

      // Ignore "relation does not exist" (42P01) — table may not be present in all envs
      if (eventArtistsError && eventArtistsError.code !== "42P01") {
        throw eventArtistsError;
      }

      const { error: artistGenresError } = await supabase
        .from("artist_genres")
        .delete()
        .eq("artist_id", artistId);

      if (artistGenresError) throw artistGenresError;

      const { error: artistDeleteError } = await supabase
        .from("artists")
        .delete()
        .eq("id", artistId);

      if (artistDeleteError) throw artistDeleteError;

      return jsonResponse({ success: true });
    }

    const { artist, genreIds } = normalizeArtistPayload((await req.json().catch(() => ({}))) as ArtistPayload);

    if (!artist.name || !artist.slug) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    if (req.method === "POST") {
      const { data, error } = await supabase
        .from("artists")
        .insert(artist)
        .select("id")
        .single();

      if (error) throw error;
      await replaceArtistGenres(supabase, data.id, genreIds);
      const artists = await fetchArtists(supabase);
      const created = artists.find((item) => item.id === data.id) ?? null;
      return jsonResponse({ artist: created }, 201);
    }

    if (!artistId) {
      return jsonResponse({ error: "Missing artist id" }, 400);
    }

    const { error } = await supabase
      .from("artists")
      .update(artist)
      .eq("id", artistId);

    if (error) throw error;
    await replaceArtistGenres(supabase, artistId, genreIds);
    const artists = await fetchArtists(supabase);
    const updated = artists.find((item) => item.id === artistId) ?? null;
    return jsonResponse({ artist: updated });
  } catch (error) {
    console.error("[api-admin-artists]", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
