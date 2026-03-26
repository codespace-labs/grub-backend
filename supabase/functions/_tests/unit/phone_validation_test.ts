import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Misma regex que usa api-public-auth-send-otp
const E164_RE = /^\+[1-9]\d{7,14}$/;

// ─── Válidos ──────────────────────────────────────────────────────────────────

Deno.test("E164 - número peruano válido", () => {
  assertEquals(E164_RE.test("+51949935871"), true);
});

Deno.test("E164 - número US válido", () => {
  assertEquals(E164_RE.test("+14155238886"), true);
});

Deno.test("E164 - número MX válido", () => {
  assertEquals(E164_RE.test("+525512345678"), true);
});

Deno.test("E164 - número AR válido", () => {
  assertEquals(E164_RE.test("+541112345678"), true);
});

// ─── Inválidos ────────────────────────────────────────────────────────────────

Deno.test("E164 - sin prefijo + es inválido", () => {
  assertEquals(E164_RE.test("51949935871"), false);
});

Deno.test("E164 - solo + es inválido", () => {
  assertEquals(E164_RE.test("+"), false);
});

Deno.test("E164 - número muy corto es inválido", () => {
  assertEquals(E164_RE.test("+5194"), false);
});

Deno.test("E164 - número muy largo es inválido", () => {
  assertEquals(E164_RE.test("+519499358710000000"), false);
});

Deno.test("E164 - letras son inválidas", () => {
  assertEquals(E164_RE.test("+51abc12345"), false);
});

Deno.test("E164 - espacios son inválidos", () => {
  assertEquals(E164_RE.test("+51 949 935 871"), false);
});

Deno.test("E164 - string vacío es inválido", () => {
  assertEquals(E164_RE.test(""), false);
});

Deno.test("E164 - empieza con +0 es inválido (no hay código de país 0)", () => {
  assertEquals(E164_RE.test("+0123456789"), false);
});
