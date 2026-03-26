import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { listVisibleGenres } from "../_shared/event-visibility.ts";

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
    const supabase = createServiceClient();
    const genres = await listVisibleGenres(supabase, {
      startDate: getStartOfTodayInLima(),
    });
    return jsonResponse({ genres });
  } catch (error) {
    console.error("[api-public-genres]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
