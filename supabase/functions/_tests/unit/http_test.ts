import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { jsonResponse, handleOptions } from "../../_shared/http.ts";

Deno.test("jsonResponse - status 200 por defecto", async () => {
  const res = jsonResponse({ ok: true });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
});

Deno.test("jsonResponse - status personalizado", async () => {
  const res = jsonResponse({ error: "no autorizado" }, 401);
  assertEquals(res.status, 401);
});

Deno.test("jsonResponse - Content-Type es application/json", () => {
  const res = jsonResponse({});
  assertEquals(res.headers.get("Content-Type"), "application/json");
});

Deno.test("jsonResponse - incluye headers CORS", () => {
  const res = jsonResponse({});
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertStringIncludes(
    res.headers.get("Access-Control-Allow-Methods") ?? "",
    "POST",
  );
});

Deno.test("handleOptions - retorna null para métodos no OPTIONS", () => {
  const req = new Request("http://localhost", { method: "POST" });
  assertEquals(handleOptions(req), null);
});

Deno.test("handleOptions - retorna 200 para OPTIONS (preflight)", () => {
  const req = new Request("http://localhost", { method: "OPTIONS" });
  const res = handleOptions(req);
  assertEquals(res?.status, 200);
  assertEquals(res?.headers.get("Access-Control-Allow-Origin"), "*");
});
