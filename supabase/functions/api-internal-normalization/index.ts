import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import {
  enrichEventsWithAiBatch,
  validateEventsWithAiBatch,
  type EnrichmentBatchInput,
  type JudgeBatchInput,
} from "../_shared/ai-event-enrichment.ts";
import {
  classifyEventsBatch,
  classifyEventFromLineup,
  getNormalizationOverview,
  lookupCanonicalArtist,
  normalizeArtist,
  type ClassifyEventsBatchInput,
  type NormalizationInput,
} from "../_shared/music-normalization-service.ts";

function badRequest(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function parseJsonBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) return record.message;
    if (typeof record.details === "string" && record.details) return record.details;
    if (typeof record.hint === "string" && record.hint) return record.hint;
    try {
      return JSON.stringify(error);
    } catch {
      return "Unexpected error";
    }
  }
  return "Unexpected error";
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  try {
    await requireInternalAccess(req, "viewer");
    const supabase = createServiceClient();
    const url = new URL(req.url);

    if (req.method === "GET") {
      const artistName = url.searchParams.get("artist_name")?.trim() ?? "";
      if (!artistName) {
        return badRequest("artist_name is required");
      }

      const artist = await lookupCanonicalArtist(supabase, artistName);
      return jsonResponse({ artist });
    }

    if (req.method !== "POST") {
      return badRequest("Method not allowed", 405);
    }

    const body = await parseJsonBody<{
      action?:
        | "normalize"
        | "batch"
        | "revalidate"
        | "classify_event"
        | "classify_events_batch"
        | "ai_enrich_events_batch"
        | "ai_judge_events_batch"
        | "overview";
      input?: NormalizationInput;
      items?: NormalizationInput[];
      options?: ClassifyEventsBatchInput;
      ai_options?: EnrichmentBatchInput;
      judge_options?: JudgeBatchInput;
    }>(req);

    const action = body.action ?? "normalize";

    if (action === "batch") {
      const items = (body.items ?? []).slice(0, 25);
      if (!items.length) return badRequest("items is required for batch");

      const results = [];
      for (const item of items) {
        results.push(await normalizeArtist(supabase, item, { action: "normalize" }));
      }

      return jsonResponse({ count: results.length, results });
    }

    if (action === "overview") {
      const overview = await getNormalizationOverview(supabase);
      return jsonResponse(overview);
    }

    if (action === "classify_events_batch") {
      const result = await classifyEventsBatch(supabase, body.options ?? {});
      return jsonResponse(result);
    }

    if (action === "ai_enrich_events_batch") {
      const result = await enrichEventsWithAiBatch(supabase, body.ai_options ?? {});
      return jsonResponse(result);
    }

    if (action === "ai_judge_events_batch") {
      const result = await validateEventsWithAiBatch(supabase, body.judge_options ?? {});
      return jsonResponse(result);
    }

    if (!body.input) {
      return badRequest("input is required");
    }

    if (action === "classify_event") {
      const result = await classifyEventFromLineup(supabase, body.input);
      return jsonResponse(result);
    }

    if (action === "revalidate") {
      const result = await normalizeArtist(
        supabase,
        { ...body.input, force_refresh: true },
        { action: "revalidate" },
      );
      return jsonResponse(result);
    }

    const result = await normalizeArtist(supabase, body.input, {
      action: "normalize",
    });
    return jsonResponse(result);
  } catch (error) {
    console.error("[api-internal-normalization]", error);
    const message = serializeError(error);
    const status =
      message === "Unauthorized" ? 401 :
      message === "Forbidden" ? 403 :
      500;
    return jsonResponse({ error: message }, status);
  }
});
