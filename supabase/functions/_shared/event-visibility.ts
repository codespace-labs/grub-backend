import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface VisibleEventCatalogFilters {
  source?: string | null;
  city?: string | null;
  genre?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
  offset?: number;
}

interface VisibleEventCatalogRow {
  id: string;
  date: string | null;
}

interface VisibleGenreRow {
  id: number;
  slug: string;
  name: string;
}

const EXCLUDED_PUBLIC_GENRE_SLUGS = new Set(["cumbia", "cumbia-andina", "folklore"]);

export async function listVisibleEventIds(
  supabase: SupabaseClient,
  filters: VisibleEventCatalogFilters = {},
): Promise<string[]> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  let query = supabase
    .from("app_visible_events_catalog")
    .select("id, date")
    .order("date", { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (filters.source) query = query.eq("source", filters.source);
  if (filters.city) query = query.eq("city", filters.city);
  if (filters.startDate) query = query.gte("date", filters.startDate);
  if (filters.endDate) query = query.lte("date", filters.endDate);
  if (filters.genre) query = query.contains("genre_slugs", [filters.genre]);

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as VisibleEventCatalogRow[]).map((row) => row.id);
}

export async function isEventVisibleInApp(
  supabase: SupabaseClient,
  eventId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("app_visible_events_catalog")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

export function orderRowsByIds<T extends { id: string }>(
  rows: T[],
  ids: string[],
): T[] {
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort((left, right) => {
    const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

export async function listVisibleGenres(
  supabase: SupabaseClient,
  filters: Pick<VisibleEventCatalogFilters, "startDate" | "endDate"> = {},
): Promise<VisibleGenreRow[]> {
  let query = supabase
    .from("app_visible_events_catalog")
    .select("genre_slugs")
    .order("date", { ascending: true, nullsFirst: false })
    .range(0, 4999);

  if (filters.startDate) query = query.gte("date", filters.startDate);
  if (filters.endDate) query = query.lte("date", filters.endDate);

  const { data, error } = await query;
  if (error) throw error;

  const visibleSlugs = Array.from(
    new Set(
      (data ?? [])
        .flatMap((row) => (Array.isArray(row.genre_slugs) ? row.genre_slugs : []))
        .filter((slug): slug is string => typeof slug === "string" && slug.length > 0)
        .filter((slug) => !EXCLUDED_PUBLIC_GENRE_SLUGS.has(slug)),
    ),
  );

  if (!visibleSlugs.length) return [];

  const genresQuery = await supabase
    .from("genres")
    .select("id, slug, name")
    .in("slug", visibleSlugs)
    .order("name", { ascending: true });

  if (genresQuery.error) throw genresQuery.error;
  return (genresQuery.data ?? []) as VisibleGenreRow[];
}
