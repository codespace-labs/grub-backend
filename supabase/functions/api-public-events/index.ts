import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { listVisibleEventIds, orderRowsByIds } from "../_shared/event-visibility.ts";
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
    const source = url.searchParams.get("source");
    const city = url.searchParams.get("city");
    const genre = url.searchParams.get("genre");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
    const startDate = url.searchParams.get("start_date") ?? getStartOfTodayInLima();
    const endDate = url.searchParams.get("end_date");

    const supabase = createServiceClient();
    const baseSelect = `
      id, name, date, start_time, cover_url, price_min, price_max, venue, city, country_code,
      availability_status, source, ticket_url,
      event_genres ( genres ( id, slug, name ) ),
      event_artists ( artists ( id, name, slug, photo_url ) )
    `;

    const visibleIds = await listVisibleEventIds(supabase, {
      source,
      city,
      genre,
      startDate,
      endDate,
      limit,
    });

    if (!visibleIds.length) {
      return jsonResponse({ events: [] });
    }

    const { data, error } = await supabase
      .from("events")
      .select(baseSelect)
      .in("id", visibleIds);

    if (error) throw error;

    const events = await attachPresentationToEvents(supabase, data ?? []);
    return jsonResponse({ events: orderRowsByIds(events, visibleIds) });
  } catch (error) {
    console.error("[api-public-events]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
