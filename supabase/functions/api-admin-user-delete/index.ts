import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type AdminRole = "superadmin" | "admin" | "operator" | "viewer";

function resolveRole(appMetadata: Record<string, unknown> | undefined, userMetadata: Record<string, unknown> | undefined): AdminRole {
  const rawRole = appMetadata?.role ?? userMetadata?.role ?? "viewer";
  if (rawRole === "superadmin" || rawRole === "admin" || rawRole === "operator" || rawRole === "viewer") {
    return rawRole;
  }
  return "viewer";
}

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
      source?: "backoffice" | "customer";
      clerk_user_id?: string | null;
    } | null;
    const userId = body?.user_id?.trim();
    const source = body?.source === "customer" ? "customer" : "backoffice";
    const clerkUserId = body?.clerk_user_id?.trim() ?? null;

    if (!userId) return jsonResponse({ error: "user_id requerido" }, 400);

    // Prevent self-deletion
    if (source === "backoffice" && userId === actor.user.id) {
      return jsonResponse({ error: "No puedes eliminar tu propia cuenta" }, 400);
    }

    const supabase = createServiceClient();

    if (source === "customer") {
      let targetId = userId;

      if (clerkUserId) {
        const { data: existingCustomerByClerk, error: existingCustomerByClerkError } = await supabase
          .from("users")
          .select("id, email, clerk_user_id")
          .eq("clerk_user_id", clerkUserId)
          .maybeSingle();

        if (existingCustomerByClerkError) throw existingCustomerByClerkError;
        if (!existingCustomerByClerk) {
          return jsonResponse({ error: "Cliente no encontrado" }, 404);
        }

        targetId = existingCustomerByClerk.id;
      }

      const { data: existingCustomer, error: existingCustomerError } = await supabase
        .from("users")
        .select("id, email, clerk_user_id")
        .eq("id", targetId)
        .maybeSingle();

      if (existingCustomerError) throw existingCustomerError;
      if (!existingCustomer) {
        return jsonResponse({ error: "Cliente no encontrado" }, 404);
      }

      const { error: deleteCustomerError } = await supabase
        .from("users")
        .delete()
        .eq("id", targetId);

      if (deleteCustomerError) throw deleteCustomerError;

      await supabase.schema("admin").from("audit_logs").insert({
        actor_user_id: actor.user.id,
        actor_role: actor.role,
        action: "admin.customer.deleted",
        entity_type: "public_user",
        entity_id: targetId,
        payload: {
          email: existingCustomer.email ?? null,
          clerk_user_id: existingCustomer.clerk_user_id ?? null,
        },
      });

      return jsonResponse({ ok: true });
    }

    const { data: existing, error: fetchError } = await supabase.auth.admin.getUserById(userId);
    if (fetchError || !existing.user) {
      return jsonResponse({ error: "Usuario no encontrado" }, 404);
    }

    const targetRole = resolveRole(existing.user.app_metadata, existing.user.user_metadata);
    if (actor.role !== "superadmin" && targetRole === "superadmin") {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    await supabase.schema("admin").from("audit_logs").insert({
      actor_user_id: actor.user.id,
      actor_role: actor.role,
      action: "admin.user.deleted",
      entity_type: "auth_user",
      entity_id: userId,
      payload: { email: existing.user.email ?? null },
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("[api-admin-user-delete]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
