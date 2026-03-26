import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { isEventVisibleInApp } from "../_shared/event-visibility.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const eventId = url.searchParams.get("id");
    if (!eventId) return jsonResponse({ error: "Missing id" }, 400);

    const supabase = createServiceClient();
    const isVisible = await isEventVisibleInApp(supabase, eventId);
    if (!isVisible) return jsonResponse({ error: "Not found" }, 404);

    const { data, error } = await supabase
      .from("events")
      .select(`
        id, name, date, start_time, venue, city, country_code, ticket_url,
        cover_url, price_min, price_max, description, availability_status, source,
        venues ( id, name, city, address, lat, lng ),
        event_genres ( genres ( slug, name ) ),
        event_artists (
          order_index,
          artists (
            id, name, slug, photo_url,
            artist_genres ( genres ( slug, name ) )
          )
        )
      `)
      .eq("id", eventId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonResponse({ error: "Not found" }, 404);

    return jsonResponse({ event: data });
  } catch (error) {
    console.error("[api-public-event-detail]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
