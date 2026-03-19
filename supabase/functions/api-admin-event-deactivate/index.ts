import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { user, role } = await requireAdmin(req, "operator");
    const { eventId, isActive = false, reason = "manual_toggle" } = await req.json();
    if (!eventId) return jsonResponse({ error: "Missing eventId" }, 400);

    const supabase = createServiceClient();
    const { data: current, error: currentError } = await supabase
      .from("events")
      .select("id, is_active")
      .eq("id", eventId)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) return jsonResponse({ error: "Not found" }, 404);

    const { data, error } = await supabase
      .from("events")
      .update({ is_active: Boolean(isActive) })
      .eq("id", eventId)
      .select("id, is_active")
      .single();

    if (error) throw error;

    await supabase.schema("admin").from("manual_event_overrides").insert({
      event_id: eventId,
      field_name: "is_active",
      previous_value: { is_active: current.is_active },
      new_value: { is_active: Boolean(isActive) },
      reason,
      created_by: user.id,
    });

    await supabase.schema("admin").from("audit_logs").insert({
      actor_user_id: user.id,
      actor_role: role,
      action: "event.toggle_active",
      entity_type: "event",
      entity_id: eventId,
      payload: { previous: current.is_active, next: Boolean(isActive), reason },
    });

    return jsonResponse({ event: data });
  } catch (error) {
    console.error("[api-admin-event-deactivate]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
