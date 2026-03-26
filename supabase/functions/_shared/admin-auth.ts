import type { User } from "https://esm.sh/@supabase/supabase-js@2";
import { createServiceClient } from "./supabase.ts";

export type AdminRole = "superadmin" | "admin" | "operator" | "viewer";

export interface AuthenticatedAdmin {
  user: User;
  role: AdminRole;
}

const ROLE_ORDER: Record<AdminRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  superadmin: 4,
};

function resolveRole(user: User): AdminRole {
  const appRole = user.app_metadata?.role;
  const userRole = user.user_metadata?.role;
  const rawRole = appRole ?? userRole ?? "viewer";

  if (rawRole === "superadmin" || rawRole === "admin" || rawRole === "operator" || rawRole === "viewer") {
    return rawRole;
  }

  return "viewer";
}

export function hasMinRole(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER[minRole];
}

export async function requireAdmin(
  req: Request,
  minRole: AdminRole = "viewer",
): Promise<AuthenticatedAdmin> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    console.error("[admin-auth] missing authorization header");
    throw new Error("Unauthorized");
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    console.error("[admin-auth] getUser failed", {
      message: error?.message ?? null,
      status: (error as { status?: number } | null)?.status ?? null,
      has_user: Boolean(data.user),
    });
    throw new Error("Unauthorized");
  }

  const role = resolveRole(data.user);
  if (!hasMinRole(role, minRole)) {
    throw new Error("Forbidden");
  }

  return { user: data.user, role };
}
