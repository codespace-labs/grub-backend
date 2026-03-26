import { requireAdmin, type AdminRole } from "./admin-auth.ts";

export async function requireInternalAccess(
  req: Request,
  minRole: AdminRole = "viewer",
): Promise<{ mode: "internal_key" | "admin"; role: AdminRole | "service" }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const internalKey = req.headers.get("x-grub-internal-key")?.trim() ?? "";

  const expectedInternalKey =
    Deno.env.get("GRUB_INTERNAL_API_KEY") ??
    Deno.env.get("INTERNAL_API_KEY") ??
    "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (
    (expectedInternalKey && internalKey && internalKey === expectedInternalKey) ||
    (serviceRoleKey && bearer && bearer === serviceRoleKey)
  ) {
    return { mode: "internal_key", role: "service" };
  }

  const admin = await requireAdmin(req, minRole);
  return { mode: "admin", role: admin.role };
}
