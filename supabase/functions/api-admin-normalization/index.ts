import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import {
  enrichEventsWithAiBatch,
  getAiAuditOverview,
  getAiPromptCatalog,
  reviewAiAuditDecision,
  validateEventsWithAiBatch,
  type EnrichmentBatchInput,
  type JudgeBatchInput,
  type ReviewAiAuditDecisionInput,
} from "../_shared/ai-event-enrichment.ts";
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
      const [overview, aiAudit] = await Promise.all([
        getNormalizationOverview(supabase),
        getAiAuditOverview(supabase, 20),
      ]);
      return jsonResponse({ ...overview, ai_audit: aiAudit, ai_prompts: getAiPromptCatalog() });
    }

    if (req.method !== "POST") {
      return badRequest("Method not allowed", 405);
    }

    const admin = await requireAdmin(req, "operator");
    const body = await req.json().catch(() => ({})) as {
      action?: "classify_events_batch" | "ai_enrich_events_batch" | "ai_judge_events_batch" | "ai_review_decision";
      options?: ClassifyEventsBatchInput;
      ai_options?: EnrichmentBatchInput;
      judge_options?: JudgeBatchInput;
      review?: ReviewAiAuditDecisionInput;
    };

    const action = body.action ?? "classify_events_batch";

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

    if (action === "ai_review_decision") {
      if (!body.review?.review_id || !body.review?.decision) {
        return badRequest("review.review_id and review.decision are required");
      }
      const result = await reviewAiAuditDecision(supabase, {
        ...body.review,
        actor_user_id: admin.user.id,
        actor_role: admin.role,
      });
      return jsonResponse(result);
    }

    return badRequest("Unsupported action");
  } catch (error) {
    console.error("[api-admin-normalization]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
