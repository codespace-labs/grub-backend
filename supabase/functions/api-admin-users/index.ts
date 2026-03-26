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
    const [{ data: authData, error: authError }, { data: customerData, error: customerError }] = await Promise.all([
      supabase.auth.admin.listUsers(),
      supabase
        .from("users")
        .select("id, clerk_user_id, provider, email, phone, display_name, avatar_url, created_at, updated_at, last_sign_in_at")
        .order("created_at", { ascending: false }),
    ]);

    if (authError) throw authError;

    // public.users puede no existir aún (migración pendiente) — no es fatal
    if (customerError) {
      console.error("[api-admin-users] public.users no disponible", {
        message: customerError.message,
        code: customerError.code,
      });
    }

    // Solo usuarios de backoffice: los que NO tienen source="app" en app_metadata.
    // Los clientes de la app que usan phone OTP se sincronizan en public.users.
    const backofficeUsers = (authData.users ?? [])
      .filter((user) => user.app_metadata?.source !== "app")
      .map((user) => {
      const rawRole = user.app_metadata?.role ?? user.user_metadata?.role ?? "viewer";
      const role =
        rawRole === "superadmin" || rawRole === "admin" || rawRole === "operator" || rawRole === "viewer"
          ? rawRole
          : "viewer";

      return {
        id: user.id,
        email: user.email ?? null,
        phone: user.phone || (user as Record<string, unknown>).new_phone as string || null,
        role,
        is_verified: user.app_metadata?.is_verified === true,
        is_banned: Boolean(user.banned_until && new Date(user.banned_until) > new Date()),
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
        source: "backoffice",
        source_label: "Backoffice",
        display_name: user.user_metadata?.display_name as string | null ?? null,
        provider: null,
        avatar_url: user.user_metadata?.avatar_url as string | null ?? null,
        clerk_user_id: null,
        editable: true,
      };
    });

    const customerUsers = (!customerError && customerData ? customerData : [])
      .filter((user) => Boolean(user.clerk_user_id || user.email || user.phone || user.display_name))
      .map((user) => ({
        id: user.id,
        email: user.email ?? null,
        phone: user.phone ?? null,
        role: "viewer" as const,
        is_verified: Boolean(user.email || user.phone),
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
        source: "customer" as const,
        source_label: "Cliente app",
        display_name: user.display_name ?? null,
        provider: user.provider === "google" || user.provider === "apple" || user.provider === "phone"
          ? user.provider
          : null,
        avatar_url: user.avatar_url ?? null,
        clerk_user_id: user.clerk_user_id ?? null,
        editable: false,
      }));

    const users = [...backofficeUsers, ...customerUsers].sort((a, b) => {
      const left = a.created_at ? Date.parse(a.created_at) : 0;
      const right = b.created_at ? Date.parse(b.created_at) : 0;
      return right - left;
    });

    return jsonResponse({ users });
  } catch (error) {
    console.error("[api-admin-users]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
