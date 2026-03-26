import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// ─── Tipos mínimos para los tests ─────────────────────────────────────────────

type AdminRole = "superadmin" | "admin" | "operator" | "viewer";

interface MockAuthUser {
  id: string;
  email?: string;
  phone?: string;
  created_at?: string;
  last_sign_in_at?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

// Replica exacta de la lógica de api-admin-users
function resolveRole(user: MockAuthUser): AdminRole {
  const rawRole =
    user.app_metadata?.role ??
    user.user_metadata?.role ??
    "viewer";
  if (
    rawRole === "superadmin" ||
    rawRole === "admin" ||
    rawRole === "operator" ||
    rawRole === "viewer"
  ) return rawRole as AdminRole;
  return "viewer";
}

function isBackofficeUser(user: MockAuthUser): boolean {
  return user.app_metadata?.source !== "app";
}

// ─── Filtrado backoffice vs clientes ──────────────────────────────────────────

Deno.test("user_mapping - usuario sin source es de backoffice", () => {
  const user: MockAuthUser = { id: "1", app_metadata: {} };
  assertEquals(isBackofficeUser(user), true);
});

Deno.test("user_mapping - usuario con source=app es cliente, NO backoffice", () => {
  const user: MockAuthUser = { id: "1", app_metadata: { source: "app" } };
  assertEquals(isBackofficeUser(user), false);
});

Deno.test("user_mapping - usuario con source=backoffice es de backoffice", () => {
  const user: MockAuthUser = { id: "1", app_metadata: { source: "backoffice" } };
  assertEquals(isBackofficeUser(user), true);
});

// ─── Resolución de roles ──────────────────────────────────────────────────────

Deno.test("resolveRole - usa app_metadata sobre user_metadata", () => {
  const user: MockAuthUser = {
    id: "1",
    app_metadata: { role: "admin" },
    user_metadata: { role: "viewer" },
  };
  assertEquals(resolveRole(user), "admin");
});

Deno.test("resolveRole - rol desconocido cae a viewer", () => {
  const user: MockAuthUser = {
    id: "1",
    app_metadata: { role: "god_mode" },
  };
  assertEquals(resolveRole(user), "viewer");
});

Deno.test("resolveRole - sin metadata es viewer", () => {
  const user: MockAuthUser = { id: "1" };
  assertEquals(resolveRole(user), "viewer");
});

Deno.test("resolveRole - todos los roles válidos se resuelven correctamente", () => {
  const roles: AdminRole[] = ["superadmin", "admin", "operator", "viewer"];
  for (const role of roles) {
    const user: MockAuthUser = { id: "1", app_metadata: { role } };
    assertEquals(resolveRole(user), role);
  }
});

// ─── Ordenamiento por fecha ───────────────────────────────────────────────────

Deno.test("user_mapping - usuarios se ordenan del más reciente al más antiguo", () => {
  const users = [
    { id: "1", created_at: "2026-01-01T00:00:00Z" },
    { id: "2", created_at: "2026-03-01T00:00:00Z" },
    { id: "3", created_at: "2026-02-01T00:00:00Z" },
  ];

  const sorted = users.sort((a, b) => {
    const left = a.created_at ? Date.parse(a.created_at) : 0;
    const right = b.created_at ? Date.parse(b.created_at) : 0;
    return right - left;
  });

  assertEquals(sorted[0].id, "2"); // más reciente primero
  assertEquals(sorted[1].id, "3");
  assertEquals(sorted[2].id, "1"); // más antiguo último
});
