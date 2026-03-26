import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type GenrePayload = {
  name?: string;
  slug?: string;
};

function getGenreIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const apiIndex = parts.findIndex((part) => part === "api-admin-genres");
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

function normalizeGenrePayload(payload: GenrePayload): Record<string, unknown> {
  const name = normalizeString(payload.name);
  const slug = normalizeString(payload.slug);

  return Object.fromEntries(
    Object.entries({
      name,
      slug: slug ? slugify(slug) : name ? slugify(name) : undefined,
    }).filter(([, value]) => value !== undefined),
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const genreId = getGenreIdFromPath(url.pathname);

    if (req.method === "GET") {
      await requireAdmin(req, "viewer");
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("genres")
        .select("id, slug, name")
        .order("name", { ascending: true });

      if (error) throw error;
      return jsonResponse({ genres: data ?? [] });
    }

    await requireAdmin(req, "operator");
    const supabase = createServiceClient();

    if (req.method === "DELETE") {
      if (!genreId) {
        return jsonResponse({ error: "Missing genre id" }, 400);
      }

      const normalizedGenreId = Number(genreId);

      const { error: eventGenreError } = await supabase
        .from("event_genres")
        .delete()
        .eq("genre_id", normalizedGenreId);

      if (eventGenreError) throw eventGenreError;

      const { error: artistGenreError } = await supabase
        .from("artist_genres")
        .delete()
        .eq("genre_id", normalizedGenreId);

      if (artistGenreError) throw artistGenreError;

      const { error: genreError } = await supabase
        .from("genres")
        .delete()
        .eq("id", normalizedGenreId);

      if (genreError) throw genreError;

      return jsonResponse({ success: true });
    }

    const payload = normalizeGenrePayload((await req.json().catch(() => ({}))) as GenrePayload);

    if (!payload.name || !payload.slug) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    if (req.method === "POST") {
      const { data, error } = await supabase
        .from("genres")
        .insert(payload)
        .select("id, slug, name")
        .single();

      if (error) throw error;
      return jsonResponse({ genre: data }, 201);
    }

    if (!genreId) {
      return jsonResponse({ error: "Missing genre id" }, 400);
    }

    const { data, error } = await supabase
      .from("genres")
      .update(payload)
      .eq("id", Number(genreId))
      .select("id, slug, name")
      .single();

    if (error) throw error;
    return jsonResponse({ genre: data });
  } catch (error) {
    console.error("[api-admin-genres]", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
