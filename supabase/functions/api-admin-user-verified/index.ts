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
    const body = (await req.json().catch(() => null)) as { user_id?: string; is_verified?: boolean } | null;
    const userId = body?.user_id?.trim();
    const isVerified = body?.is_verified;

    if (!userId || typeof isVerified !== "boolean") {
      return jsonResponse({ error: "Invalid payload" }, 400);
    }

    const supabase = createServiceClient();
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      throw userError ?? new Error("User not found");
    }

    const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...userData.user.app_metadata,
        is_verified: isVerified,
      },
    });

    if (updateError || !updated.user) {
      throw updateError ?? new Error("Could not update user");
    }

    await supabase.schema("admin").from("audit_logs").insert({
      actor_user_id: actor.user.id,
      actor_role: actor.role,
      action: "admin.user_verified.updated",
      entity_type: "auth_user",
      entity_id: userId,
      payload: {
        is_verified: isVerified,
        email: updated.user.email ?? null,
      },
    });

    return jsonResponse({
      ok: true,
      user: {
        id: updated.user.id,
        email: updated.user.email ?? null,
        is_verified: isVerified,
      },
    });
  } catch (error) {
    console.error("[api-admin-user-verified]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
