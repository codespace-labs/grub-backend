/**
 * Tests de integración para api-public-auth-verify-otp.
 * Requieren SUPABASE_URL y SUPABASE_ANON_KEY en el entorno.
 */
import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";

const BASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ENDPOINT = `${BASE_URL}/functions/v1/api-public-auth-verify-otp`;

const skip = !BASE_URL || !ANON_KEY;

function headers() {
  return {
    "Content-Type": "application/json",
    "apikey": ANON_KEY,
    "Authorization": `Bearer ${ANON_KEY}`,
  };
}

Deno.test({
  name: "verify-otp - OPTIONS retorna CORS headers",
  ignore: skip,
  fn: async () => {
    const res = await fetch(ENDPOINT, { method: "OPTIONS", headers: headers() });
    assertEquals(res.status, 200);
    assertExists(res.headers.get("Access-Control-Allow-Origin"));
  },
});

Deno.test({
  name: "verify-otp - GET retorna 405",
  ignore: skip,
  fn: async () => {
    const res = await fetch(ENDPOINT, { method: "GET", headers: headers() });
    assertEquals(res.status, 405);
  },
});

Deno.test({
  name: "verify-otp - sin phone ni token retorna 400",
  ignore: skip,
  fn: async () => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertExists(body.error);
  },
});

Deno.test({
  name: "verify-otp - código incorrecto retorna 401",
  ignore: skip,
  fn: async () => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ phone: "+51999000001", token: "000000" }),
    });
    assertEquals(res.status, 401);
    const body = await res.json();
    assertExists(body.error);
  },
});
