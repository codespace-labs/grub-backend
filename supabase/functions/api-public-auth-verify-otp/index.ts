import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createAnonClient, createServiceClient } from "../_shared/supabase.ts";

const OTP_TYPE = Deno.env.get("AUTH_PHONE_CHANNEL") === "whatsapp"
  ? "whatsapp"
  : "sms";

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let phone: string;
  let token: string;
  try {
    const body = await req.json() as { phone?: unknown; token?: unknown };
    phone = typeof body.phone === "string" ? body.phone.trim() : "";
    token = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!phone || !token) {
    return jsonResponse({ error: "Se requieren phone y token" }, 400);
  }

  try {
    const supabase = createAnonClient();
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: OTP_TYPE,
    });

    if (error) {
      console.error("[api-public-auth-verify-otp]", error.message);
      // Supabase returns 401-level errors as normal errors with specific messages
      const isExpired =
        error.message.toLowerCase().includes("expired") ||
        error.message.toLowerCase().includes("invalid") ||
        error.message.toLowerCase().includes("token");
      return jsonResponse({ error: error.message }, isExpired ? 401 : 500);
    }

    if (!data.session || !data.user) {
      return jsonResponse({ error: "No se pudo crear la sesión" }, 401);
    }

    // ── Sincronizar en public.users y marcar source en auth ───────────────────
    const serviceClient = createServiceClient();

    // Upsert en public.users (fuente de verdad para clientes de la app)
    const { error: syncError } = await serviceClient
      .from("users")
      .upsert(
        {
          supabase_user_id: data.user.id,
          provider:         "phone",
          provider_user_id: null,
          phone:            data.user.phone ?? phone,
          email:            null,
          display_name:     null,
          avatar_url:       null,
          updated_at:       new Date().toISOString(),
        },
        { onConflict: "supabase_user_id" },
      );

    if (syncError) {
      console.error("[api-public-auth-verify-otp] sync a public.users fallido", {
        user_id: data.user.id,
        message: syncError.message,
      });
    }

    // Marcar como cliente de la app para que api-admin-users lo clasifique
    // como "cliente" y no como usuario de backoffice.
    await serviceClient.auth.admin.updateUserById(data.user.id, {
      app_metadata: { source: "app", provider: "phone" },
    }).catch((e: Error) =>
      console.error("[api-public-auth-verify-otp] metadata update fallido", e.message)
    );

    console.log("[api-public-auth-verify-otp] verificado y sincronizado", {
      user_id: data.user.id,
    });

    return jsonResponse({
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
      user:          data.session.user,
    });
  } catch (err) {
    console.error("[api-public-auth-verify-otp] unexpected", err);
    return jsonResponse({ error: "Error interno del servidor" }, 500);
  }
});
