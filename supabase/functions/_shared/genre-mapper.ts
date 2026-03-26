// ─── Genre mapper ─────────────────────────────────────────────────────────────
//
// Dos funciones complementarias:
//
//   mapToCanonicalGenre(rawGenre)  — para etiquetas explícitas del scraper
//                                    ("Rock", "Hip-Hop/Rap", "EBM")
//                                    → devuelve un slug canónico o null
//
//   inferGenres(eventName, venue)  — para inferir géneros del nombre del evento
//                                    → devuelve array de slugs canónicos
//
// REGLA: nunca usar LLM. Los géneros sin mapeo claro se dejan en null/[].
//
// Slugs canónicos válidos:
//   rock · pop · electronica · hip-hop · reggaeton · metal · jazz
//   salsa · indie · urbano · clasica · cumbia · rnb · punk · alternativo

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Normalización ────────────────────────────────────────────────────────────
// Replica la misma lógica del _normalize_genre() de la migración SQL.

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita tildes
    .replace(/[''`]/g, "");
}

// ─── Tabla de mapeo canónico ──────────────────────────────────────────────────
// Orden importa: las reglas más específicas van primero.
// null = excluido del onboarding (el evento se guarda igual, sin ese género).

const CANONICAL_MAP: ReadonlyArray<[RegExp, string | null]> = [
  // ── Excluidos (retornan null) ─────────────────────────────────────────────
  [/motivacional|conferencia|charla|talk|speaker/,                   null],
  [/musica peruana|musica andina|criollo|chicha|huayno|folklore|folklorico/, null],
  [/industrial|shoegaze|progressive rock|prog rock|world music/,     null],
  [/new age|spoken word|ambient/,                                    null],

  // ── Electrónica ──────────────────────────────────────────────────────────
  [/electro|edm|techno|house|eurodance|electronic body|ebm/,        "electronica"],
  [/trance|minimal|drum.?n.?bass|dnb|breakbeat|\brave\b/,            "electronica"],

  // ── Metal ────────────────────────────────────────────────────────────────
  [/metal|heavy/,                                                    "metal"],

  // ── Punk ─────────────────────────────────────────────────────────────────
  [/^punk$|punk rock|hardcore/,                                      "punk"],

  // ── Rock ─────────────────────────────────────────────────────────────────
  [/rock|blues/,                                                     "rock"],

  // ── Indie ────────────────────────────────────────────────────────────────
  [/indie/,                                                          "indie"],

  // ── Alternativo ──────────────────────────────────────────────────────────
  [/alternati|folk|flamenco/,                                        "alternativo"],

  // ── Pop ──────────────────────────────────────────────────────────────────
  [/k.?pop|kpop/,                                                    "pop"],
  [/^pop$|pop latino|latin pop/,                                     "pop"],

  // ── Hip-Hop / Rap ─────────────────────────────────────────────────────────
  [/hip.?hop|^rap$/,                                                 "hip-hop"],

  // ── Urbano (trap + urban latin) ───────────────────────────────────────────
  [/^trap$|trap latino|urbano|urban latin|freestyle/,                "urbano"],

  // ── Reggaetón ────────────────────────────────────────────────────────────
  [/reggaet|perreo|dembow/,                                          "reggaeton"],

  // ── R&B ──────────────────────────────────────────────────────────────────
  [/r.?&.?b|^rnb$|r.n.b|soul|neo.?soul|funk/,                       "rnb"],

  // ── Jazz ─────────────────────────────────────────────────────────────────
  [/^jazz$|jazz fusion|jazz latino/,                                 "jazz"],

  // ── Clásica ───────────────────────────────────────────────────────────────
  [/clasic|classical|sinfon|orquest|filarmoni|camara|opera|barroco/, "clasica"],

  // ── Salsa / Tropical ─────────────────────────────────────────────────────
  [/^salsa$|salsa dura|salsa romantica|tropical|bachata|merengue/,   "salsa"],

  // ── Cumbia ───────────────────────────────────────────────────────────────
  [/cumbia/,                                                         "cumbia"],
];

// ─── mapToCanonicalGenre ──────────────────────────────────────────────────────

/**
 * Mapea una etiqueta de género raw (proveniente del scraper) al slug canónico.
 *
 * - Función pura: sin I/O, sin efectos secundarios.
 * - Retorna null si el género no tiene mapeo canónico válido (el evento se
 *   guarda igual, simplemente sin ese género).
 *
 * @example
 *   mapToCanonicalGenre("EBM (Electronic Body Music)") → "electronica"
 *   mapToCanonicalGenre("Motivacional / Conferencia")  → null
 *   mapToCanonicalGenre("Hip-Hop/Rap")                 → "hip-hop"
 *   mapToCanonicalGenre("Música Peruana Tradicional")  → null
 *   mapToCanonicalGenre("Urban Latin")                 → "urbano"
 */
export function mapToCanonicalGenre(rawGenre: string): string | null {
  const norm = normalize(rawGenre);
  for (const [re, slug] of CANONICAL_MAP) {
    if (re.test(norm)) return slug;
  }
  return null;
}

// ─── inferGenres ──────────────────────────────────────────────────────────────
// Infiere géneros canónicos desde el nombre del evento (haystack matching).
// Mantiene compatibilidad con el uso existente en los scrapers.

const INFER_RULES: ReadonlyArray<[RegExp, string]> = [
  [/electro|edm|\brave\b|circoloco|creamfields|awakenings|\bultra\b/,  "electronica"],
  [/\btechno\b|\bhouse\b|tech\s*house|deep\s*house/,                   "electronica"],
  [/reggaet/,                                                          "reggaeton"],
  [/hip[\s-]hop|\brap\b/,                                              "hip-hop"],
  [/\btrap\b|\burbano\b/,                                              "urbano"],
  [/r\s*&\s*b|\brnb\b|r'n'b|\bsoul\b/,                                "rnb"],
  [/\bsalsa\b|tropical|bachata|merengue/,                              "salsa"],
  [/cumbia/,                                                           "cumbia"],
  [/\brock\b/,                                                         "rock"],
  [/\bmetal\b|heavy\s*metal/,                                          "metal"],
  [/\bpunk\b|hardcore/,                                                "punk"],
  [/\bindie\b/,                                                        "indie"],
  [/\bfolk\b|alternati|flamenco/,                                      "alternativo"],
  [/k[\s-]?pop|kpop|\bpop\b/,                                          "pop"],
  [/\bjazz\b/,                                                         "jazz"],
  [/clasica|clasico|classical|sinfon|orquesta|filarmoni/,              "clasica"],
];

/**
 * Infiere slugs canónicos a partir del nombre del evento (y opcionalmente del venue).
 *
 * - Solo keyword matching: sin llamadas externas, sin LLM.
 * - Devuelve [] si no hay señal clara.
 * - Devuelve slugs únicos.
 *
 * @example
 *   inferGenres("Daddy Yankee Reggaeton Tour")   → ["reggaeton"]
 *   inferGenres("Festival Techno Rave 2026")     → ["electronica"]
 */
export function inferGenres(name: string, venue = ""): string[] {
  const haystack = `${name} ${venue}`.toLowerCase();
  const slugs    = new Set<string>();

  for (const [re, slug] of INFER_RULES) {
    if (re.test(haystack)) slugs.add(slug);
  }

  return [...slugs];
}

// ─── linkGenres ───────────────────────────────────────────────────────────────
// Vincula slugs con la tabla event_genres en una sola query (sin N+1).

export async function linkGenres(
  supabase: SupabaseClient,
  eventId: string,
  slugs: string[],
): Promise<void> {
  if (!slugs.length) return;

  const { data: genres, error } = await supabase
    .from("genres")
    .select("id, slug")
    .in("slug", slugs);

  if (error) {
    console.error("[linkGenres] no se pudo consultar géneros:", error.message);
    return;
  }

  if (!genres?.length) return;

  const rows = genres.map((g) => ({ event_id: eventId, genre_id: g.id }));

  const { error: insertErr } = await supabase
    .from("event_genres")
    .upsert(rows, { onConflict: "event_id,genre_id", ignoreDuplicates: true });

  if (insertErr) {
    console.error("[linkGenres] insert error:", insertErr.message);
  }
}
