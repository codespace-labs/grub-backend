import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin, type AdminRole } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

interface UpdateRoleBody {
  user_id?: string;
  role?: AdminRole;
}

function isAdminRole(value: string | undefined): value is AdminRole {
  return value === "admin" || value === "operator" || value === "viewer";
}

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const actor = await requireAdmin(req, "admin");
    const body = (await req.json().catch(() => null)) as UpdateRoleBody | null;
    const userId = body?.user_id?.trim();
    const nextRole = body?.role;

    if (!userId || !isAdminRole(nextRole)) {
      return jsonResponse({ error: "Invalid payload" }, 400);
    }

    const supabase = createServiceClient();
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      throw userError ?? new Error("User not found");
    }

    const previousRole =
      userData.user.app_metadata?.role ?? userData.user.user_metadata?.role ?? "viewer";

    const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...userData.user.app_metadata,
        role: nextRole,
      },
    });

    if (updateError || !updated.user) {
      throw updateError ?? new Error("Could not update role");
    }

    await supabase.from("audit_logs").insert({
      actor_user_id: actor.user.id,
      actor_role: actor.role,
      action: "admin.user_role.updated",
      entity_type: "auth_user",
      entity_id: userId,
      payload: {
        previous_role: previousRole,
        new_role: nextRole,
        email: updated.user.email ?? null,
      },
    });

    return jsonResponse({
      ok: true,
      user: {
        id: updated.user.id,
        email: updated.user.email ?? null,
        role: nextRole,
        created_at: updated.user.created_at ?? null,
        last_sign_in_at: updated.user.last_sign_in_at ?? null,
      },
    });
  } catch (error) {
    console.error("[api-admin-user-role]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
