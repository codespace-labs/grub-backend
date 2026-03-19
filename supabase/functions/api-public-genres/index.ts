import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("genres")
      .select("id, slug, name")
      .order("name", { ascending: true });

    if (error) throw error;
    return jsonResponse({ genres: data ?? [] });
  } catch (error) {
    console.error("[api-public-genres]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
