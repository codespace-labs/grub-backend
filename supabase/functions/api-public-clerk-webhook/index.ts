/**
 * api-public-clerk-webhook
 *
 * Recibe eventos de Clerk (user.created, user.updated) y sincroniza el usuario
 * en public.users usando el service role de Supabase.
 *
 * Configuración requerida:
 *  - Clerk Dashboard → Webhooks → Add Endpoint → URL: <supabase_url>/functions/v1/api-public-clerk-webhook
 *  - Eventos: user.created, user.updated
 *  - Copiar el Signing Secret y añadirlo como CLERK_WEBHOOK_SECRET en Supabase Edge Function secrets
 */

import { createServiceClient } from "../_shared/supabase.ts";
import { jsonResponse } from "../_shared/http.ts";

const CLERK_WEBHOOK_SECRET = Deno.env.get("CLERK_WEBHOOK_SECRET") ?? "";

// ---------------------------------------------------------------------------
// Verificación de firma Svix (usado por Clerk)
// Spec: https://docs.svix.com/receiving/verifying-payloads/how
// ---------------------------------------------------------------------------
async function verifyClerkWebhook(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
): Promise<boolean> {
  if (!CLERK_WEBHOOK_SECRET) {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET no configurado");
    return false;
  }
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Decodificar el secreto (formato: "whsec_<base64>")
  const secretBase64 = CLERK_WEBHOOK_SECRET.replace(/^whsec_/, "");
  let secretBytes: Uint8Array;
  try {
    secretBytes = Uint8Array.from(atob(secretBase64), (c) => c.charCodeAt(0));
  } catch {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET con formato inválido");
    return false;
  }

  const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(toSign),
  );

  const computed = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  // svix-signature puede contener múltiples firmas separadas por espacio: "v1,abc v1,def"
  return svixSignature.split(" ").some((s) => s.replace(/^v1,/, "") === computed);
}

// ---------------------------------------------------------------------------
// Tipos del payload de Clerk
// ---------------------------------------------------------------------------
type ClerkExternalAccount = {
  provider: string;         // "oauth_google" | "oauth_apple" | ...
  provider_user_id: string; // Sub del proveedor externo
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

type ClerkUserData = {
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

// ---------------------------------------------------------------------------
// Helpers para extraer datos del payload
// ---------------------------------------------------------------------------
function resolveProvider(data: ClerkUserData): {
  provider: "google" | "apple" | "phone";
  provider_user_id: string | null;
} {
  const ext = data.external_accounts ?? [];
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

function resolveEmail(data: ClerkUserData): string | null {
  const emails = data.email_addresses ?? [];
  if (!emails.length) return null;
  if (data.primary_email_address_id) {
    const primary = emails.find((e) => e.id === data.primary_email_address_id);
    if (primary) return primary.email_address;
  }
  return emails[0].email_address;
}

function resolvePhone(data: ClerkUserData): string | null {
  const phones = data.phone_numbers ?? [];
  if (!phones.length) return null;
  if (data.primary_phone_number_id) {
    const primary = phones.find((p) => p.id === data.primary_phone_number_id);
    if (primary) return primary.phone_number;
  }
  return phones[0].phone_number;
}

function resolveDisplayName(data: ClerkUserData): string | null {
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

function resolveLastSignInAt(value: number | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const svixId        = req.headers.get("svix-id")        ?? "";
  const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
  const svixSignature = req.headers.get("svix-signature") ?? "";

  // Leer el body como texto para poder verificar la firma antes de parsear
  const rawBody = await req.text();

  const valid = await verifyClerkWebhook(rawBody, svixId, svixTimestamp, svixSignature);
  if (!valid) {
    console.error("[clerk-webhook] firma inválida");
    return jsonResponse({ error: "Invalid webhook signature" }, 401);
  }

  let event: { type: string; data: ClerkUserData };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // Solo procesamos creación y actualización de usuarios
  if (event.type !== "user.created" && event.type !== "user.updated") {
    return jsonResponse({ ok: true, skipped: true });
  }

  const userData = event.data;
  const { provider, provider_user_id } = resolveProvider(userData);

  const supabase = createServiceClient();

  const { error } = await supabase
    .from("users")
    .upsert(
      {
        id:               crypto.randomUUID(),
        clerk_user_id:    userData.id,
        provider,
        provider_user_id,
        email:            resolveEmail(userData),
        phone:            resolvePhone(userData),
        display_name:     resolveDisplayName(userData),
        avatar_url:       userData.image_url ?? null,
        last_sign_in_at:  resolveLastSignInAt(userData.last_sign_in_at),
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" },
    );

  if (error) {
    console.error("[clerk-webhook] upsert fallido", {
      clerk_user_id: userData.id,
      event_type: event.type,
      message: error.message,
    });
    return jsonResponse({ error: "Failed to upsert user" }, 500);
  }

  console.log(`[clerk-webhook] ${event.type} sincronizado`, {
    clerk_user_id: userData.id,
    provider,
  });
  return jsonResponse({ ok: true });
});
