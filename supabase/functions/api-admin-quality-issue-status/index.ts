import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

interface UpdateIssueBody {
  issueId?: string;
  status?: "open" | "ignored" | "resolved";
}

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { user, role } = await requireAdmin(req, "operator");
    const body = (await req.json().catch(() => null)) as UpdateIssueBody | null;
    const issueId = body?.issueId?.trim();
    const status = body?.status;

    if (!issueId || (status !== "ignored" && status !== "resolved" && status !== "open")) {
      return jsonResponse({ error: "Invalid payload" }, 400);
    }

    const supabase = createServiceClient();
    const { data: current, error: currentError } = await supabase
      .schema("quality")
      .from("quality_issues")
      .select("id, status")
      .eq("id", issueId)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) return jsonResponse({ error: "Not found" }, 404);

    const { data, error } = await supabase
      .schema("quality")
      .from("quality_issues")
      .update({
        status,
        resolved_at: status === "open" ? null : new Date().toISOString(),
        resolved_by: status === "open" ? null : user.id,
      })
      .eq("id", issueId)
      .select("*")
      .single();

    if (error) throw error;

    await supabase.schema("admin").from("audit_logs").insert({
      actor_user_id: user.id,
      actor_role: role,
      action: "quality.issue.status_updated",
      entity_type: "quality_issue",
      entity_id: issueId,
      payload: {
        previous_status: current.status,
        next_status: status,
      },
    });

    return jsonResponse({ issue: data });
  } catch (error) {
    console.error("[api-admin-quality-issue-status]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
