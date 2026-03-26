import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin, hasMinRole } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import type { AdminRole } from "../_shared/admin-auth.ts";

function resolveUpsertError(error: unknown): { message: string; status: number } {
  const rawMessage = error instanceof Error ? error.message : "Internal server error";
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes("duplicate key") ||
    normalized.includes("already registered") ||
    normalized.includes("already been registered") ||
    normalized.includes("email address already") ||
    normalized.includes("email_exists") ||
    normalized.includes("user already registered")
  ) {
    return {
      message: "El email ya está en uso por otro usuario.",
      status: 409,
    };
  }

  return {
    message: rawMessage,
    status: rawMessage === "Unauthorized" ? 401 : rawMessage === "Forbidden" ? 403 : 500,
  };
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
      email?: string;
      password?: string;
      phone?: string;
      role?: AdminRole;
      is_verified?: boolean;
    } | null;

    if (!body) return jsonResponse({ error: "Invalid payload" }, 400);

    const { user_id, email, password, role, is_verified } = body;
    // Normalize phone to E.164 format (+XXXXXXXXXX)
    const rawPhone = typeof body.phone === "string" ? body.phone.trim() : null;
    const phone = rawPhone
      ? rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`
      : rawPhone;

    const isCreate = !user_id;

    // Solo superadmin puede asignar rol superadmin
    if (role === "superadmin" && actor.role !== "superadmin") {
      return jsonResponse({ error: "Forbidden: solo superadmin puede asignar ese rol" }, 403);
    }

    const supabase = createServiceClient();

    if (isCreate) {
      if (!email) return jsonResponse({ error: "email requerido" }, 400);
      if (!password) return jsonResponse({ error: "password requerido" }, 400);

      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        phone: phone || undefined,
        email_confirm: true,
        phone_confirm: Boolean(phone),
        app_metadata: {
          role: role ?? "viewer",
          is_verified: is_verified ?? false,
        },
      });

      if (createError || !created.user) {
        throw createError ?? new Error("No se pudo crear el usuario");
      }

      await supabase.schema("admin").from("audit_logs").insert({
        actor_user_id: actor.user.id,
        actor_role: actor.role,
        action: "admin.user.created",
        entity_type: "auth_user",
        entity_id: created.user.id,
        payload: { email, role: role ?? "viewer", is_verified: is_verified ?? false },
      });

      return jsonResponse({
        ok: true,
        user: {
          id: created.user.id,
          email: created.user.email ?? null,
          phone: created.user.phone ?? null,
          role: role ?? "viewer",
          is_verified: is_verified ?? false,
          created_at: created.user.created_at ?? null,
          last_sign_in_at: created.user.last_sign_in_at ?? null,
        },
      });
    }

    // UPDATE path
    const { data: existing, error: fetchError } = await supabase.auth.admin.getUserById(user_id!);
    if (fetchError || !existing.user) {
      return jsonResponse({ error: "Usuario no encontrado" }, 404);
    }

    const targetRaw = existing.user.app_metadata?.role ?? "viewer";
    const targetRole: AdminRole =
      targetRaw === "superadmin" || targetRaw === "admin" || targetRaw === "operator" || targetRaw === "viewer"
        ? targetRaw
        : "viewer";

    // Solo superadmin puede editar a otros superadmin
    if (targetRole === "superadmin" && !hasMinRole(actor.role, "superadmin")) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const updatePayload: Record<string, unknown> = {};
    if (email) updatePayload.email = email;
    if (password) updatePayload.password = password;
    if (phone !== undefined) {
      updatePayload.phone = phone || null;
      if (phone) updatePayload.phone_confirm = true;
    }

    const currentMeta = existing.user.app_metadata ?? {};
    const newMeta = { ...currentMeta };
    if (role !== undefined) newMeta.role = role;
    if (is_verified !== undefined) newMeta.is_verified = is_verified;
    updatePayload.app_metadata = newMeta;

    const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(
      user_id!,
      updatePayload as Parameters<typeof supabase.auth.admin.updateUserById>[1],
    );

    if (updateError || !updated.user) {
      throw updateError ?? new Error("No se pudo actualizar el usuario");
    }

    await supabase.schema("admin").from("audit_logs").insert({
      actor_user_id: actor.user.id,
      actor_role: actor.role,
      action: "admin.user.updated",
      entity_type: "auth_user",
      entity_id: user_id,
      payload: { email, phone, role, is_verified },
    });

    const resolvedRole: AdminRole =
      newMeta.role === "superadmin" || newMeta.role === "admin" || newMeta.role === "operator" || newMeta.role === "viewer"
        ? newMeta.role
        : "viewer";

    return jsonResponse({
      ok: true,
      user: {
        id: updated.user.id,
        email: updated.user.email ?? null,
        phone: updated.user.phone ?? null,
        role: resolvedRole,
        is_verified: newMeta.is_verified === true,
        created_at: updated.user.created_at ?? null,
        last_sign_in_at: updated.user.last_sign_in_at ?? null,
      },
    });
  } catch (error) {
    console.error("[api-admin-user-upsert]", error);
    const { message, status } = resolveUpsertError(error);
    return jsonResponse({ error: message }, status);
  }
});
