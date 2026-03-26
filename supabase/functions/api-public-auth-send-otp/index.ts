import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createAnonClient } from "../_shared/supabase.ts";

const E164_RE = /^\+[1-9]\d{7,14}$/;
const PHONE_CHANNEL = Deno.env.get("AUTH_PHONE_CHANNEL") === "whatsapp"
  ? "whatsapp"
  : "sms";

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let phone: string;
  try {
    const body = await req.json() as { phone?: unknown };
    phone = typeof body.phone === "string" ? body.phone.trim() : "";
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!phone || !E164_RE.test(phone)) {
    return jsonResponse(
      { error: "Número de teléfono inválido. Usa formato E.164, ej: +51999999999" },
      400,
    );
  }

  try {
    const supabase = createAnonClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: { channel: PHONE_CHANNEL },
    });

    if (error) {
      console.error("[api-public-auth-send-otp]", error.message);
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[api-public-auth-send-otp] unexpected", err);
    return jsonResponse({ error: "Error interno del servidor" }, 500);
  }
});
