import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import {
  classifyEventsBatch,
  getNormalizationOverview,
  type ClassifyEventsBatchInput,
} from "../_shared/music-normalization-service.ts";

function badRequest(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const supabase = createServiceClient();

    if (req.method === "GET") {
      await requireAdmin(req, "viewer");
      const overview = await getNormalizationOverview(supabase);
      return jsonResponse(overview);
    }

    if (req.method !== "POST") {
      return badRequest("Method not allowed", 405);
    }

    await requireAdmin(req, "operator");
    const body = await req.json().catch(() => ({})) as {
      action?: "classify_events_batch";
      options?: ClassifyEventsBatchInput;
    };

    if ((body.action ?? "classify_events_batch") !== "classify_events_batch") {
      return badRequest("Unsupported action");
    }

    const result = await classifyEventsBatch(supabase, body.options ?? {});
    return jsonResponse(result);
  } catch (error) {
    console.error("[api-admin-normalization]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
