import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { listVisibleEventIds, listVisibleGenres, orderRowsByIds } from "../_shared/event-visibility.ts";
import { attachPresentationToEvents } from "../_shared/event-presentation.ts";

function getStartOfTodayInLima(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T00:00:00-05:00`;
}

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
    const startDate = url.searchParams.get("start_date") ?? getStartOfTodayInLima();

    const supabase = createServiceClient();
    const eventsSelect = `
      id, name, date, start_time, cover_url, price_min, venue, city, country_code,
      event_genres ( genres ( id, slug, name ) ),
      event_artists ( artists ( id, name, slug, photo_url ) )
    `;
    const [featuredIds, listedIds] = await Promise.all([
      listVisibleEventIds(supabase, {
        startDate,
        limit: featuredLimit,
        offset: 0,
      }),
      listVisibleEventIds(supabase, {
        startDate,
        limit: listedLimit,
        offset: featuredLimit,
      }),
    ]);

    const allIds = [...new Set([...featuredIds, ...listedIds])];

    const genres = await listVisibleGenres(supabase, { startDate });

    const eventsResult = allIds.length
      ? await supabase.from("events").select(eventsSelect).in("id", allIds)
      : { data: [], error: null };

    if (eventsResult.error) throw eventsResult.error;

    const rows = await attachPresentationToEvents(supabase, eventsResult.data ?? []);
    const featured = orderRowsByIds(rows.filter((row) => featuredIds.includes(row.id)), featuredIds);
    const listed = orderRowsByIds(rows.filter((row) => listedIds.includes(row.id)), listedIds);

    return jsonResponse({
      featured,
      listed,
      genres,
    });
  } catch (error) {
    console.error("[api-public-feed-home]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
