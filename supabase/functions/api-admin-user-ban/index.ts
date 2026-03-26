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
    const actor = await requireAdmin(req, "admin");

    const body = (await req.json().catch(() => null)) as {
      user_id?: string;
      ban: boolean;
    } | null;

    const userId = body?.user_id?.trim();
    if (!userId) return jsonResponse({ error: "user_id requerido" }, 400);

    if (userId === actor.user.id) {
      return jsonResponse({ error: "No puedes desactivar tu propia cuenta" }, 400);
    }

    const supabase = createServiceClient();

    const { data: existing, error: fetchError } = await supabase.auth.admin.getUserById(userId);
    if (fetchError || !existing.user) {
      return jsonResponse({ error: "Usuario no encontrado" }, 404);
    }

    // Evita que admin desactive a otro admin o superadmin
    const targetRole = existing.user.app_metadata?.role ?? "viewer";
    if (actor.role === "admin" && (targetRole === "admin" || targetRole === "superadmin")) {
      return jsonResponse({ error: "No tienes permiso para desactivar este usuario" }, 403);
    }

    const ban_duration = body?.ban ? "876600h" : "none"; // ~100 años = permanente

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration,
    });
    if (updateError) throw updateError;

    await supabase.schema("admin").from("audit_logs").insert({
      actor_user_id: actor.user.id,
      actor_role: actor.role,
      action: body?.ban ? "admin.user.banned" : "admin.user.unbanned",
      entity_type: "auth_user",
      entity_id: userId,
      payload: { email: existing.user.email ?? null },
    });

    return jsonResponse({ ok: true, is_banned: body?.ban });
  } catch (error) {
    console.error("[api-admin-user-ban]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
