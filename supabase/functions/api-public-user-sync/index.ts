/**
 * api-public-user-sync
 *
 * Sincroniza un usuario de Clerk en public.users inmediatamente después del auth exitoso.
 * Se llama desde el cliente (mobile) tras cualquier flujo de autenticación: OTP, Google, Apple.
 *
 * El webhook de Clerk sigue activo como respaldo y para actualizaciones posteriores.
 *
 * Configuración requerida en Supabase Edge Function secrets:
 *  - CLERK_SECRET_KEY  →  sk_test_... o sk_live_...  (Clerk Dashboard → API Keys)
 *  - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (ya presentes en el entorno de Supabase)
 *
 * Seguridad:
 *  - El cliente envía { clerk_user_id } en el body.
 *  - Esta función verifica que el usuario existe en Clerk llamando a la API de Clerk
 *    con CLERK_SECRET_KEY. Si el ID es inválido o inexistente, Clerk devuelve 404.
 *  - Los datos que se persisten vienen de Clerk (fuente autoritativa), no del cliente.
 */

import { createServiceClient } from "../_shared/supabase.ts";
import { jsonResponse, handleOptions } from "../_shared/http.ts";

const CLERK_SECRET_KEY = Deno.env.get("CLERK_SECRET_KEY") ?? "";

// ─── Tipos del payload de Clerk ───────────────────────────────────────────────
type ClerkExternalAccount = {
  provider: string;
  provider_user_id: string;
  email_address?: string;
};

type ClerkEmailAddress = {
  id: string;
  email_address: string;
};

type ClerkPhoneNumber = {
  id: string;
  phone_number: string;
};

type ClerkUser = {
  id: string;
  email_addresses?: ClerkEmailAddress[];
  phone_numbers?: ClerkPhoneNumber[];
  external_accounts?: ClerkExternalAccount[];
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  primary_email_address_id?: string | null;
  primary_phone_number_id?: string | null;
  last_sign_in_at?: number | null;
};

// ─── Obtener usuario desde Clerk API ──────────────────────────────────────────
async function fetchClerkUser(clerkUserId: string): Promise<ClerkUser | null> {
  if (!CLERK_SECRET_KEY) {
    console.error("[user-sync] CLERK_SECRET_KEY no configurado");
    return null;
  }

  const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[user-sync] Clerk API error", {
      status: res.status,
      clerk_user_id: clerkUserId,
      body,
    });
    return null;
  }

  return res.json();
}

// ─── Helpers para resolver campos del usuario ─────────────────────────────────
function resolveProvider(user: ClerkUser): {
  provider: "google" | "apple" | "phone";
  provider_user_id: string | null;
} {
  const ext = user.external_accounts ?? [];
  const google = ext.find((a) =>
    a.provider === "google" || a.provider === "oauth_google"
  );
  if (google) return { provider: "google", provider_user_id: google.provider_user_id };

  const apple = ext.find((a) =>
    a.provider === "apple" || a.provider === "oauth_apple"
  );
  if (apple) return { provider: "apple", provider_user_id: apple.provider_user_id };

  return { provider: "phone", provider_user_id: null };
}

function resolveEmail(user: ClerkUser): string | null {
  const emails = user.email_addresses ?? [];
  if (!emails.length) return null;
  if (user.primary_email_address_id) {
    const primary = emails.find((e) => e.id === user.primary_email_address_id);
    if (primary) return primary.email_address;
  }
  return emails[0]?.email_address ?? null;
}

function resolvePhone(user: ClerkUser): string | null {
  const phones = user.phone_numbers ?? [];
  if (!phones.length) return null;
  if (user.primary_phone_number_id) {
    const primary = phones.find((p) => p.id === user.primary_phone_number_id);
    if (primary) return primary.phone_number;
  }
  return phones[0]?.phone_number ?? null;
}

function resolveDisplayName(user: ClerkUser): string | null {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

function resolveLastSignInAt(value: number | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

// ─── Handler principal ────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Parsear body
  let body: { clerk_user_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const clerkUserId = body.clerk_user_id?.trim();
  if (!clerkUserId) {
    return jsonResponse({ error: "clerk_user_id es requerido" }, 400);
  }

  // Validar formato básico del ID de Clerk (user_XXXX)
  if (!/^user_/.test(clerkUserId)) {
    return jsonResponse({ error: "clerk_user_id inválido" }, 400);
  }

  // Obtener datos autoritativos desde Clerk
  const clerkUser = await fetchClerkUser(clerkUserId);
  if (!clerkUser) {
    return jsonResponse({ error: "Usuario no encontrado en Clerk" }, 404);
  }

  // Resolver campos
  const { provider, provider_user_id } = resolveProvider(clerkUser);

  // Upsert en public.users
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        id:               crypto.randomUUID(),
        clerk_user_id:    clerkUser.id,
        provider,
        provider_user_id,
        email:            resolveEmail(clerkUser),
        phone:            resolvePhone(clerkUser),
        display_name:     resolveDisplayName(clerkUser),
        avatar_url:       clerkUser.image_url ?? null,
        last_sign_in_at:  resolveLastSignInAt(clerkUser.last_sign_in_at),
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" },
    )
    .select()
    .single();

  if (error) {
    console.error("[user-sync] upsert fallido", {
      clerk_user_id: clerkUser.id,
      provider,
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return jsonResponse({
      error: "Error al guardar usuario",
      debug: {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      },
    }, 500);
  }

  console.log("[user-sync] usuario sincronizado", {
    clerk_user_id: clerkUser.id,
    provider,
    id: data.id,
  });

  return jsonResponse({ ok: true, user: data });
});
