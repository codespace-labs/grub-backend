import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { hasMinRole, type AdminRole } from "../../_shared/admin-auth.ts";

// ─── hasMinRole ───────────────────────────────────────────────────────────────

const ROLES: AdminRole[] = ["viewer", "operator", "admin", "superadmin"];

Deno.test("hasMinRole - superadmin tiene acceso a todo", () => {
  for (const role of ROLES) {
    assertEquals(hasMinRole("superadmin", role), true, `superadmin debe tener acceso a ${role}`);
  }
});

Deno.test("hasMinRole - viewer solo accede a viewer", () => {
  assertEquals(hasMinRole("viewer", "viewer"), true);
  assertEquals(hasMinRole("viewer", "operator"), false);
  assertEquals(hasMinRole("viewer", "admin"), false);
  assertEquals(hasMinRole("viewer", "superadmin"), false);
});

Deno.test("hasMinRole - operator accede a viewer y operator", () => {
  assertEquals(hasMinRole("operator", "viewer"), true);
  assertEquals(hasMinRole("operator", "operator"), true);
  assertEquals(hasMinRole("operator", "admin"), false);
  assertEquals(hasMinRole("operator", "superadmin"), false);
});

Deno.test("hasMinRole - admin accede a todo excepto superadmin", () => {
  assertEquals(hasMinRole("admin", "viewer"), true);
  assertEquals(hasMinRole("admin", "operator"), true);
  assertEquals(hasMinRole("admin", "admin"), true);
  assertEquals(hasMinRole("admin", "superadmin"), false);
});

Deno.test("hasMinRole - mismo rol siempre es true", () => {
  for (const role of ROLES) {
    assertEquals(hasMinRole(role, role), true, `${role} debe tener acceso a sí mismo`);
  }
});
