import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    await requireAdmin(req, "operator");

    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;

    const users = (data.users ?? []).map((user) => {
      const rawRole = user.app_metadata?.role ?? user.user_metadata?.role ?? "viewer";
      const role =
        rawRole === "admin" || rawRole === "operator" || rawRole === "viewer"
          ? rawRole
          : "viewer";

      return {
        id: user.id,
        email: user.email ?? null,
        role,
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
      };
    });

    return jsonResponse({ users });
  } catch (error) {
    console.error("[api-admin-users]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
