import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  searchDiscogsArtist,
  searchMusicBrainzArtist,
  searchSpotifyArtist,
  type MusicBrainzCandidate,
} from "./music-provider-clients.ts";
import { getEditorialExclusionReason } from "./music-filter.ts";

export interface NormalizationInput {
  artist_name?: string | null;
  lineup?: string[];
  raw_genres?: string[];
  raw_tags?: string[];
  source_platform?: string | null;
  source_url?: string | null;
  external_id?: string | null;
  event_id?: string | null;
  event_context?: {
    event_name?: string | null;
    country?: string | null;
    city?: string | null;
    venue?: string | null;
    date?: string | null;
  } | null;
  persist?: boolean;
  force_refresh?: boolean;
}

interface ArtistRow {
  id: string;
  name: string;
  slug: string;
  musicbrainz_id: string | null;
}

interface GenreRow {
  id: string;
  slug: string;
  name: string;
}

interface GenreMappingRow {
  normalized_value: string;
  confidence: number;
  canonical_subgenre_slug: string | null;
  canonical_subgenre_name: string | null;
  genre_id: string | number;
}

export interface NormalizedGenre {
  genre_id: string;
  genre_slug: string;
  genre_name: string;
  subgenre_slug: string | null;
  subgenre_name: string | null;
  confidence: number;
}

export interface NormalizationResult {
  status: "matched" | "matched_low_confidence" | "ambiguous" | "unresolved";
  artist: {
    id: string | null;
    canonical_name: string | null;
    musicbrainz_id: string | null;
    matched_alias: string | null;
  };
  genres: NormalizedGenre[];
  confidence: number;
  review_required: boolean;
  discarded_tags: string[];
  unmapped_signals: string[];
  sources: Array<{
    provider: string;
    used_for: string;
    score: number;
    provider_entity_id?: string | null;
  }>;
  trace: {
    cache_hit: boolean;
    cache_key: string;
    run_id: string;
  };
}

interface ResolveOptions {
  action: "normalize" | "revalidate" | "classify";
}

export interface ClassifyEventsBatchInput {
  limit?: number;
  source?: string | null;
  date_from?: string | null;
  only_without_genres?: boolean;
  dry_run?: boolean;
  force_refresh?: boolean;
  exclude_event_ids?: string[];
}

export interface ClassifyEventsBatchResult {
  count_selected: number;
  count_processed: number;
  count_classified: number;
  count_ambiguous: number;
  count_skipped_no_artist: number;
  count_failed: number;
  dry_run: boolean;
  results?: Array<{
    event_id: string;
    event_name: string | null;
    inferred_artists: string[];
    status: "classified" | "ambiguous" | "skipped_no_artist" | "failed";
    normalization_status?: NormalizationResult["status"];
    genres: string[];
    confidence?: number;
    review_required?: boolean;
    review_reason_code?: string;
    unmapped_signals?: string[];
    discarded_tags?: string[];
    source_providers?: string[];
    error?: string;
  }>;
}

export interface NormalizationOverview {
  classified_today_count: number;
  open_review_count: number;
  open_missing_artist_count: number;
  open_unresolved_artist_count: number;
  top_unmapped_signals: Array<{
    signal: string;
    total: number;
  }>;
}

interface EventRowForClassification {
  id: string;
  name: string | null;
  description: string | null;
  lineup: unknown;
  event_artists?: unknown;
  source: string | null;
  ticket_url: string | null;
  city: string | null;
  country_code: string | null;
  venue: string | null;
  date: string | null;
  event_genres?: Array<{ genre_id?: string | number | null }> | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybeMessage = (error as Record<string, unknown>).message;
    const maybeDetails = (error as Record<string, unknown>).details;
    if (typeof maybeMessage === "string" && maybeMessage) return maybeMessage;
    if (typeof maybeDetails === "string" && maybeDetails) return maybeDetails;
    try {
      return JSON.stringify(error);
    } catch {
      return "Unexpected normalization error";
    }
  }
  return "Unexpected normalization error";
}

function isClearlyNonMusicalEvent(row: Pick<EventRowForClassification, "name" | "venue">): boolean {
  const name = row.name ?? "";
  if (!name.trim()) return false;
  return Boolean(getEditorialExclusionReason({ name, venue: row.venue ?? null }));
}

function extractLineupValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function extractArtistNamesFromLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const names = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const artistWrapper = (item as Record<string, unknown>).artists;
      if (!artistWrapper || typeof artistWrapper !== "object") return null;
      const name = (artistWrapper as Record<string, unknown>).name;
      return typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
    })
    .filter((name): name is string => Boolean(name));

  return dedupe(names);
}

const SIGNAL_BLACKLIST = new Set([
  "festival",
  "music",
  "live music",
  "latin",
  "american",
  "usa",
  "us",
  "party",
  "vip",
  "all ages",
  "sunset",
  "good vibes",
  "romantic",
  "experience",
  "show",
  "concert",
  "concierto",
]);

const OVERVIEW_SIGNAL_BLACKLIST = new Set([
  ...SIGNAL_BLACKLIST,
  "live",
  "world",
  "tour",
  "international",
  "global",
]);

const GENERIC_EVENT_TITLES = new Set([
  "juntos en concierto",
  "la despedida",
  "campeones",
  "ellas en concierto",
  "ellos en concierto",
  "noche de oro",
  "noche dorada",
  "semana santa tunantera",
  "dias de teatro 2026",
  "dias de teatro",
  "días de teatro 2026",
  "días de teatro",
  "voces para mama",
  "voces para mamá",
]);

const LOW_SIGNAL_EVENT_PATTERNS = [
  /\ben concierto\b/i,
  /\ben vivo\b/i,
  /\beventos?\s+en\s+vivo\b/i,
  /\bfest(?:ival)?\b/i,
  /\bcarnaval\b/i,
  /\baniversario\b/i,
  /\bsemana santa\b/i,
  /\bserenata\b/i,
  /\bhomenaje\b/i,
  /\btributo\b/i,
  /\bedicion\b/i,
  /\bedición\b/i,
  /\bshow\b/i,
  /\bimitaciones\b/i,
  /\bteatro\b/i,
  /\bparty\b/i,
];

const ACCESSORY_EVENT_PATTERNS = [
  /\bestacionamiento\b/i,
  /\bparking\b/i,
  /\bacceso\b/i,
  /\bentrada\b/i,
  /\bmeet\s*&?\s*greet\b/i,
  /\btraslado\b/i,
  /\bpass\b/i,
];

const PROMOTIONAL_SEGMENT_PATTERNS = [
  /\bworld tour\b.*$/i,
  /\blatam tour\b.*$/i,
  /\blatin american tour\b.*$/i,
  /\bglobal tour\b.*$/i,
  /\bhits tour\b.*$/i,
  /\btour\b.*$/i,
  /\bfecha\b.*$/i,
  /\bedicion\b.*$/i,
  /\bedición\b.*$/i,
  /\bintimo\b.*$/i,
  /\bíntimo\b.*$/i,
  /\ben (lima|arequipa|cusco|trujillo|piura|huancayo|iquitos|tarapoto|barranca|chimbote|chiclayo|callao)\b.*$/i,
  /\bby\s+.+$/i,
  /\bun año en el cielo\b.*$/i,
  /\bel ultimo regreso\b.*$/i,
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(feat|featuring|ft|with|tour|live|en vivo|invitados?)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericEventTitle(value: string): boolean {
  return GENERIC_EVENT_TITLES.has(normalizeText(value));
}

function looksLikeAccessoryEvent(value: string): boolean {
  return ACCESSORY_EVENT_PATTERNS.some((pattern) => pattern.test(value));
}

function cleanupInferredArtistSegment(segment: string): string {
  let cleaned = segment
    .replace(/^[\s"'`´“”\-:]+|[\s"'`´“”\-:]+$/g, "")
    .replace(/^(?:tributo a|homenaje a)\s+/i, "")
    .replace(/\b(?:cerati x siempre|x siempre)\b/gi, "")
    .replace(/\b(?:con banda en vivo|presenta)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const pattern of PROMOTIONAL_SEGMENT_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").trim();
  }

  cleaned = cleaned
    .replace(/\b(?:edicion de lujo|edición de lujo|especial día de la madre|especial dia de la madre)\b.*$/i, "")
    .replace(/\b(?:con amor a mamá|con amor a mama|homenaje a mamá|homenaje a mama)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";
  if (looksLikeAccessoryEvent(cleaned)) return "";
  if (isGenericEventTitle(cleaned)) return "";

  return cleaned;
}

function splitArtistSegments(value: string): string[] {
  return value
    .split(/\s+-\s+/)
    .flatMap((segment) => segment.split(/\s*:\s*/))
    .flatMap((segment) => segment.split(/\s*(?:\+|&|,|\sy\s|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i));
}

function inferArtistsFromDescription(description: string | null | undefined): string[] {
  const raw = (description ?? "").trim();
  if (!raw) return [];

  const lines = dedupe(
    raw
      .split(/\r?\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0 && line.length <= 160),
  );

  const extracted = lines.flatMap((line) => {
    const directMatch = line.match(
      /\b(?:artista|artistas|lineup|alineacion|alineación|invitados?|feat\.?|ft\.?|junto a|con)\b\s*[:\-]\s*(.+)$/i,
    );
    const value = directMatch?.[1] ?? null;
    if (!value) return [];
    return splitArtistSegments(value)
      .map((segment) => cleanupInferredArtistSegment(segment))
      .filter(Boolean);
  });

  return dedupe(extracted).slice(0, 6);
}

function deriveArtistCandidates(input: {
  eventName?: string | null;
  description?: string | null;
  linkedArtistNames?: string[];
  lineupValues?: string[];
  explicitArtistName?: string | null;
  explicitLineup?: string[];
}): string[] {
  const candidates = dedupe([
    ...(input.linkedArtistNames ?? []),
    ...(input.lineupValues ?? []),
    ...(input.explicitArtistName ? [input.explicitArtistName] : []),
    ...(input.explicitLineup ?? []),
    ...inferArtistsFromDescription(input.description),
    ...inferArtistsFromEventTitle(input.eventName),
  ].map((value) => value.trim()).filter(Boolean));

  return candidates.slice(0, 6);
}

export function inferArtistsFromEventTitle(eventName: string | null | undefined): string[] {
  const rawTitle = (eventName ?? "").trim();
  if (!rawTitle) return [];
  if (looksLikeAccessoryEvent(rawTitle)) return [];
  if (isGenericEventTitle(rawTitle)) return [];
  if (LOW_SIGNAL_EVENT_PATTERNS.some((pattern) => pattern.test(rawTitle))) return [];

  let working = rawTitle.replace(/\s+/g, " ").trim();
  const presenterParts = working.split(/\b(?:presenta|presents?|pres\.)\s*:/i);
  if (presenterParts.length > 1) {
    working = presenterParts[presenterParts.length - 1].trim();
  }

  working = working.replace(/^(?:tributo a|homenaje a)\s+/i, "").trim();

  const seedSegments = splitArtistSegments(working)
    .map((segment) => cleanupInferredArtistSegment(segment))
    .filter(Boolean);

  const fallback = cleanupInferredArtistSegment(working);
  const artists = dedupe(seedSegments.length ? seedSegments : (fallback ? [fallback] : []));

  return artists.filter((artist) => {
    const normalized = normalizeText(artist);
    if (!normalized) return false;
    if (isGenericEventTitle(normalized)) return false;
    return normalized.split(" ").length <= 8;
  }).slice(0, 4);
}

function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, "-");
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(limit, 1), values.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function confidenceToStatus(
  confidence: number,
): NormalizationResult["status"] {
  if (confidence >= 0.85) return "matched";
  if (confidence >= 0.65) return "matched_low_confidence";
  if (confidence >= 0.45) return "ambiguous";
  return "unresolved";
}

function chooseTopGenres(genres: NormalizedGenre[]): NormalizedGenre[] {
  const sorted = [...genres].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    return left.genre_slug.localeCompare(right.genre_slug);
  });

  const preferredOrder = ["indie", "rock", "alternativo"];
  const bySlug = new Map<string, NormalizedGenre>();

  for (const genre of sorted) {
    if (!bySlug.has(genre.genre_slug)) {
      bySlug.set(genre.genre_slug, genre);
    }
  }

  const selected: NormalizedGenre[] = [];
  for (const slug of preferredOrder) {
    const genre = bySlug.get(slug);
    if (genre) selected.push(genre);
    if (selected.length >= 2) break;
  }

  if (selected.length < 2) {
    for (const genre of sorted) {
      if (selected.some((item) => item.genre_slug === genre.genre_slug)) continue;
      selected.push(genre);
      if (selected.length >= 2) break;
    }
  }

  return selected;
}

function ttlDaysForStatus(status: NormalizationResult["status"]): number {
  switch (status) {
    case "matched":
      return 180;
    case "matched_low_confidence":
      return 30;
    case "ambiguous":
      return 7;
    case "unresolved":
      return 3;
  }
}

async function recordRawInput(
  supabase: SupabaseClient,
  input: NormalizationInput,
): Promise<void> {
  const payloadHash = await sha256(JSON.stringify(input));
  await supabase
    .schema("normalization")
    .from("raw_inputs")
    .insert({
      source_platform: input.source_platform ?? "unknown",
      entity_type: input.event_id ? "event" : "artist",
      external_id: input.external_id ?? input.event_id ?? null,
      source_url: input.source_url ?? null,
      payload: input,
      payload_hash: payloadHash,
    }, { defaultToNull: false });
}

async function createRun(
  supabase: SupabaseClient,
  input: NormalizationInput,
  action: ResolveOptions["action"],
  cacheKey: string,
): Promise<string> {
  const { data, error } = await supabase
    .schema("normalization")
    .from("runs")
    .insert({
      entity_type: input.event_id ? "event" : "artist",
      action,
      cache_key: cacheKey,
      input_payload: input,
      status: "running",
    })
    .select("id")
    .single();

  if (error || !data) throw error ?? new Error("No se pudo crear normalization run");
  return data.id as string;
}

async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  result: Omit<NormalizationResult, "trace">,
  sourcesUsed: string[],
): Promise<void> {
  await supabase
    .schema("normalization")
    .from("runs")
    .update({
      result_payload: result,
      status: result.status,
      confidence: result.confidence,
      review_required: result.review_required,
      sources_used: sourcesUsed,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

async function failRun(
  supabase: SupabaseClient,
  runId: string,
  message: string,
): Promise<void> {
  await supabase
    .schema("normalization")
    .from("runs")
    .update({
      status: "failed",
      error_message: message,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

async function insertEvidence(
  supabase: SupabaseClient,
  runId: string,
  entries: Array<{
    provider: string;
    used_for: string;
    provider_entity_id?: string | null;
    score: number;
    raw_payload: unknown;
  }>,
): Promise<void> {
  if (!entries.length) return;

  await supabase
    .schema("normalization")
    .from("evidence")
    .insert(
      entries.map((entry) => ({
        run_id: runId,
        provider: entry.provider,
        used_for: entry.used_for,
        provider_entity_id: entry.provider_entity_id ?? null,
        score: entry.score,
        raw_payload: entry.raw_payload,
      })),
    );
}

async function enqueueReview(
  supabase: SupabaseClient,
  runId: string,
  entityType: string,
  reasonCode: string,
  payload: unknown,
): Promise<void> {
  await supabase
    .schema("normalization")
    .from("review_queue")
    .insert({
      run_id: runId,
      entity_type: entityType,
      reason_code: reasonCode,
      payload,
    });
}

async function resolveMatchingReviewItems(
  supabase: SupabaseClient,
  input: NormalizationInput,
): Promise<void> {
  const eventId = input.event_id?.trim();
  const artistName = input.artist_name?.trim();
  if (!eventId && !artistName) return;

  const { data, error } = await supabase
    .schema("normalization")
    .from("review_queue")
    .select("id, payload")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(250);

  if (error || !data?.length) return;

  const matchingIds = (data as Array<{ id: string; payload?: Record<string, unknown> | null }>)
    .filter((item) => {
      const payload = item.payload ?? {};
      const payloadInput = payload.input && typeof payload.input === "object"
        ? payload.input as Record<string, unknown>
        : null;

      if (!payloadInput) return false;
      if (eventId && payloadInput.event_id === eventId) return true;
      if (artistName && payloadInput.artist_name === artistName) return true;
      return false;
    })
    .map((item) => item.id);

  if (!matchingIds.length) return;

  await supabase
    .schema("normalization")
    .from("review_queue")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
    })
    .in("id", matchingIds);
}

async function getCacheEntry(
  supabase: SupabaseClient,
  cacheKey: string,
): Promise<NormalizationResult | null> {
  const { data, error } = await supabase
    .schema("normalization")
    .from("cache_entries")
    .select("result_payload, expires_at")
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data?.result_payload) return null;
  return data.result_payload as NormalizationResult;
}

async function putCacheEntry(
  supabase: SupabaseClient,
  cacheKey: string,
  input: NormalizationInput,
  result: NormalizationResult,
): Promise<void> {
  const status = result.status;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDaysForStatus(status));

  await supabase
    .schema("normalization")
    .from("cache_entries")
    .upsert({
      cache_key: cacheKey,
      entity_type: input.event_id ? "event" : "artist",
      input_hash: await sha256(JSON.stringify(input)),
      input_payload: input,
      result_payload: result,
      confidence: result.confidence,
      status,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "cache_key" });
}

async function lookupLocalArtist(
  supabase: SupabaseClient,
  artistName: string,
): Promise<{ artist: ArtistRow | null; matchedAlias: string | null; confidence: number }> {
  const slug = slugify(artistName);
  const normalized = normalizeText(artistName);

  const { data: aliasRows } = await supabase
    .schema("normalization")
    .from("artist_aliases")
    .select("alias, confidence, artist:artist_id ( id, name, slug, musicbrainz_id )")
    .eq("normalized_alias", normalized)
    .limit(1);

  const aliasMatch = Array.isArray(aliasRows) ? aliasRows[0] as Record<string, unknown> : null;
  if (aliasMatch?.artist && typeof aliasMatch.artist === "object") {
    const artist = aliasMatch.artist as Record<string, unknown>;
    return {
      artist: {
        id: String(artist.id ?? ""),
        name: String(artist.name ?? ""),
        slug: String(artist.slug ?? ""),
        musicbrainz_id:
          typeof artist.musicbrainz_id === "string" ? artist.musicbrainz_id : null,
      },
      matchedAlias: typeof aliasMatch.alias === "string" ? aliasMatch.alias : artistName,
      confidence: Number(aliasMatch.confidence ?? 0.84),
    };
  }

  const { data } = await supabase
    .from("artists")
    .select("id, name, slug, musicbrainz_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) return { artist: null, matchedAlias: null, confidence: 0 };

  return {
    artist: data as ArtistRow,
    matchedAlias: artistName,
    confidence: data.musicbrainz_id ? 0.86 : 0.72,
  };
}

async function upsertArtistAlias(
  supabase: SupabaseClient,
  artistId: string,
  alias: string,
  confidence: number,
  source: string,
): Promise<void> {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return;

  await supabase
    .schema("normalization")
    .from("artist_aliases")
    .upsert({
      artist_id: artistId,
      alias,
      normalized_alias: normalizedAlias,
      confidence,
      source,
    }, { onConflict: "artist_id,normalized_alias" });
}

async function ensureArtistRecord(
  supabase: SupabaseClient,
  artistName: string,
  musicbrainzId: string | null,
): Promise<ArtistRow | null> {
  const local = await lookupLocalArtist(supabase, artistName);
  if (local.artist) {
    if (musicbrainzId && !local.artist.musicbrainz_id) {
      await supabase
        .from("artists")
        .update({ musicbrainz_id: musicbrainzId })
        .eq("id", local.artist.id);
      local.artist.musicbrainz_id = musicbrainzId;
    }
    await upsertArtistAlias(supabase, local.artist.id, artistName, 0.92, "normalization");
    return local.artist;
  }

  const payload = {
    name: artistName,
    slug: slugify(artistName),
    musicbrainz_id: musicbrainzId,
  };

  const { data, error } = await supabase
    .from("artists")
    .upsert(payload, { onConflict: "slug" })
    .select("id, name, slug, musicbrainz_id")
    .single();

  if (error) {
    const retried = await lookupLocalArtist(supabase, artistName);
    if (retried.artist) {
      await upsertArtistAlias(supabase, retried.artist.id, artistName, 0.9, "normalization");
    }
    return retried.artist;
  }

  await upsertArtistAlias(supabase, data.id as string, artistName, 0.95, "normalization");
  return data as ArtistRow;
}

function scoreMusicBrainzCandidate(
  candidate: MusicBrainzCandidate,
  input: NormalizationInput,
): number {
  let score = Math.min(candidate.score / 100, 0.75);
  const normalizedInput = normalizeText(input.artist_name);
  const normalizedCandidate = normalizeText(candidate.name);

  if (normalizedInput === normalizedCandidate) score += 0.15;
  if (
    input.event_context?.country &&
    candidate.country &&
    input.event_context.country.toUpperCase() === candidate.country.toUpperCase()
  ) {
    score += 0.05;
  }

  return Math.min(score, 0.98);
}

function shouldUseSpotifyFallback(
  mbScore: number,
  discogsSignals: string[],
): boolean {
  return mbScore < 0.78 || discogsSignals.length === 0;
}

async function resolveArtistIdentity(
  supabase: SupabaseClient,
  input: NormalizationInput,
): Promise<{
  artist: ArtistRow | null;
  matchedAlias: string | null;
  confidence: number;
  evidence: Array<{ provider: string; used_for: string; provider_entity_id?: string | null; score: number; raw_payload: unknown }>;
  supplementalSignals: string[];
}> {
  const artistName = input.artist_name?.trim() ?? "";
  if (!artistName) {
    return {
      artist: null,
      matchedAlias: null,
      confidence: 0,
      evidence: [],
      supplementalSignals: [],
    };
  }

  const local = await lookupLocalArtist(supabase, artistName);
  if (local.artist?.musicbrainz_id) {
    return {
      artist: local.artist,
      matchedAlias: local.matchedAlias,
      confidence: local.confidence,
      evidence: [{
        provider: "local_cache",
        used_for: "artist_identity",
        provider_entity_id: local.artist.musicbrainz_id,
        score: local.confidence,
        raw_payload: local.artist,
      }],
      supplementalSignals: [],
    };
  }

  const mbCandidates = await searchMusicBrainzArtist(artistName);
  const bestMbCandidate = mbCandidates
    .map((candidate) => ({ candidate, score: scoreMusicBrainzCandidate(candidate, input) }))
    .sort((left, right) => right.score - left.score)[0];

  let spotifySignals: string[] = [];
  const evidence = mbCandidates.slice(0, 3).map((candidate) => ({
    provider: "musicbrainz",
    used_for: "artist_identity",
    provider_entity_id: candidate.id,
    score: scoreMusicBrainzCandidate(candidate, input),
    raw_payload: candidate,
  }));

  if (!bestMbCandidate || bestMbCandidate.score < 0.45) {
    return {
      artist: local.artist,
      matchedAlias: local.matchedAlias,
      confidence: local.artist ? local.confidence : 0.2,
      evidence,
      supplementalSignals: [],
    };
  }

  if (shouldUseSpotifyFallback(bestMbCandidate.score, bestMbCandidate.candidate.tags)) {
    const spotifyCandidates = await searchSpotifyArtist(artistName);
    spotifySignals = dedupe(spotifyCandidates.flatMap((artist) => artist.genres));
    evidence.push(
      ...spotifyCandidates.map((artist) => ({
        provider: "spotify",
        used_for: "artist_fallback",
        provider_entity_id: artist.id,
        score: artist.popularity >= 70 ? 0.2 : 0.1,
        raw_payload: artist,
      })),
    );
  }

  const artist = await ensureArtistRecord(
    supabase,
    bestMbCandidate.candidate.name || artistName,
    bestMbCandidate.candidate.id,
  );

  return {
    artist,
    matchedAlias: artistName,
    confidence: Math.max(bestMbCandidate.score, local.confidence),
    evidence,
    supplementalSignals: dedupe([
      ...bestMbCandidate.candidate.tags,
      ...spotifySignals,
    ]),
  };
}

async function mapSignalsToGenres(
  supabase: SupabaseClient,
  signals: string[],
): Promise<{
  genres: NormalizedGenre[];
  discarded: string[];
  unmapped: string[];
  evidence: Array<{ provider: string; used_for: string; provider_entity_id?: string | null; score: number; raw_payload: unknown }>;
}> {
  const normalizedSignals = dedupe(
    signals
      .map((value) => normalizeText(value))
      .filter(Boolean),
  );

  const discarded = normalizedSignals.filter((value) => SIGNAL_BLACKLIST.has(value));
  const candidates = normalizedSignals.filter((value) => !SIGNAL_BLACKLIST.has(value));

  if (!candidates.length) {
    return { genres: [], discarded, unmapped: [], evidence: [] };
  }

  const { data, error } = await supabase
    .schema("normalization")
    .from("genre_synonyms")
    .select(`
      genre_id,
      normalized_value,
      confidence,
      canonical_subgenre_slug,
      canonical_subgenre_name
    `)
    .in("normalized_value", candidates);

  if (error) throw error;

  const matchedRows = (data ?? []) as GenreMappingRow[];
  const uniqueGenreIds = dedupe(
    matchedRows
      .map((row) => Number(row.genre_id))
      .filter((value) => Number.isFinite(value)),
  );

  const { data: genreRows, error: genreError } = await supabase
    .from("genres")
    .select("id, slug, name")
    .in("id", uniqueGenreIds);

  if (genreError) throw genreError;

  const genreById = new Map<string, GenreRow>(
    (genreRows ?? []).map((genre) => [String(genre.id), genre as GenreRow]),
  );

  const genres = dedupe(
    matchedRows
      .map((row) => {
        const genre = genreById.get(String(row.genre_id));
        if (!genre) return null;
        return {
          genre_id: String(genre.id),
          genre_slug: genre.slug,
          genre_name: genre.name,
          subgenre_slug: row.canonical_subgenre_slug,
          subgenre_name: row.canonical_subgenre_name,
          confidence: Number(row.confidence ?? 0.75),
        } satisfies NormalizedGenre;
      })
      .filter((value): value is NormalizedGenre => Boolean(value))
      .map((genre) => JSON.stringify(genre)),
  ).map((value) => JSON.parse(value) as NormalizedGenre);

  const matchedValues = new Set(matchedRows.map((row) => row.normalized_value));
  const unmapped = candidates.filter((value) => !matchedValues.has(value));

  return {
    genres,
    discarded,
    unmapped,
    evidence: matchedRows.map((row) => ({
      provider: "grub_taxonomy",
      used_for: "genre_mapping",
      provider_entity_id: String(row.genre_id),
      score: Number(row.confidence ?? 0.75),
      raw_payload: row,
    })),
  };
}

async function resolveGenres(
  supabase: SupabaseClient,
  input: NormalizationInput,
  artist: ArtistRow | null,
  artistSignals: string[],
): Promise<{
  genres: NormalizedGenre[];
  discarded: string[];
  unmapped: string[];
  evidence: Array<{ provider: string; used_for: string; provider_entity_id?: string | null; score: number; raw_payload: unknown }>;
}> {
  const artistName = artist?.name ?? input.artist_name ?? "";
  const discogsCandidates = artistName
    ? await searchDiscogsArtist(artistName)
    : [];

  const discogsSignals = dedupe(
    discogsCandidates.flatMap((candidate) => [
      ...candidate.genres,
      ...candidate.styles,
    ]),
  );

  const mapped = await mapSignalsToGenres(
    supabase,
    dedupe([
      ...(input.raw_genres ?? []),
      ...(input.raw_tags ?? []),
      ...artistSignals,
      ...discogsSignals,
    ]),
  );

  const evidence = [
    ...discogsCandidates.slice(0, 3).map((candidate) => ({
      provider: "discogs",
      used_for: "genre_resolution",
      provider_entity_id: candidate.id,
      score: candidate.styles.length > 0 || candidate.genres.length > 0 ? 0.78 : 0.52,
      raw_payload: candidate,
    })),
    ...mapped.evidence,
  ];

  return {
    genres: mapped.genres,
    discarded: mapped.discarded,
    unmapped: mapped.unmapped,
    evidence,
  };
}

async function persistGenreLinks(
  supabase: SupabaseClient,
  artistId: string,
  genres: NormalizedGenre[],
): Promise<void> {
  if (!genres.length) return;

  const genreIds = genres.map((genre) => genre.genre_id);
  const { data: existingLinks, error: existingError } = await supabase
    .from("artist_genres")
    .select("genre_id")
    .eq("artist_id", artistId)
    .in("genre_id", genreIds);

  if (existingError) throw new Error(existingError.message);

  const existingGenreIds = new Set(
    (existingLinks ?? []).map((row) => String((row as { genre_id: string | number }).genre_id)),
  );
  const rowsToInsert = genres
    .filter((genre) => !existingGenreIds.has(String(genre.genre_id)))
    .map((genre) => ({
      artist_id: artistId,
      genre_id: genre.genre_id,
    }));

  if (!rowsToInsert.length) return;

  await supabase
    .from("artist_genres")
    .insert(rowsToInsert);
}

async function persistEventClassification(
  supabase: SupabaseClient,
  eventId: string,
  runId: string,
  genres: NormalizedGenre[],
  artistIds: string[],
  confidence: number,
): Promise<void> {
  const primary = genres[0] ?? null;

  await supabase
    .schema("normalization")
    .from("event_classifications")
    .upsert({
      event_id: eventId,
      primary_genre_id: primary?.genre_id ?? null,
      primary_subgenre_slug: primary?.subgenre_slug ?? null,
      primary_subgenre_name: primary?.subgenre_name ?? null,
      confidence,
      derived_from_artist_ids: artistIds,
      normalization_run_id: runId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "event_id" });

  const desiredGenreIds = dedupe(
    genres.map((genre) => String(genre.genre_id)).filter(Boolean),
  );
  if (!desiredGenreIds.length) return;

  const { data: existingRows, error: existingRowsError } = await supabase
    .from("event_genres")
    .select("genre_id")
    .eq("event_id", eventId)
    .in("genre_id", desiredGenreIds);

  if (existingRowsError) {
    throw new Error(existingRowsError.message);
  }

  const existingGenreIds = new Set(
    (existingRows ?? []).map((row) => String((row as { genre_id: string | number }).genre_id)),
  );
  const rowsToInsert = desiredGenreIds
    .filter((genreId) => !existingGenreIds.has(genreId))
    .map((genreId) => ({
      event_id: eventId,
      genre_id: genreId,
    }));

  if (!rowsToInsert.length) return;

  const { error: insertEventGenresError } = await supabase
    .from("event_genres")
    .insert(rowsToInsert);

  if (insertEventGenresError) {
    throw new Error(insertEventGenresError.message);
  }
}

async function hydrateClassificationInput(
  supabase: SupabaseClient,
  input: NormalizationInput,
): Promise<NormalizationInput> {
  if (!input.event_id) return input;
  if ((input.lineup?.length ?? 0) > 0 || input.artist_name?.trim()) return input;

  const { data } = await supabase
    .from("events")
    .select(`
      name,
      description,
      lineup,
      source,
      ticket_url,
      city,
      country_code,
      venue,
      date,
      event_artists (
        order_index,
        artists ( name )
      )
    `)
    .eq("id", input.event_id)
    .maybeSingle();

  if (!data) return input;

  const inferredArtists = inferArtistsFromEventTitle(
    typeof data.name === "string" ? data.name : null,
  );
  const linkedArtistNames = extractArtistNamesFromLinks(
    (data as Record<string, unknown>).event_artists,
  );
  const lineupValues = extractLineupValues((data as Record<string, unknown>).lineup);
  const derivedCandidates = deriveArtistCandidates({
    eventName: typeof data.name === "string" ? data.name : null,
    description: typeof (data as Record<string, unknown>).description === "string"
      ? String((data as Record<string, unknown>).description)
      : null,
    linkedArtistNames,
    lineupValues,
    explicitArtistName: input.artist_name,
    explicitLineup: input.lineup,
  });
  const canonicalLineup = linkedArtistNames.length > 0
    ? linkedArtistNames
    : lineupValues.length > 0
      ? lineupValues
      : derivedCandidates;
  const fallbackArtist = canonicalLineup[0] ?? inferredArtists[0] ?? null;

  return {
    ...input,
    artist_name: input.artist_name ?? fallbackArtist,
    lineup: input.lineup ?? canonicalLineup,
    source_platform: input.source_platform ?? (typeof data.source === "string" ? data.source : null),
    source_url: input.source_url ?? (typeof data.ticket_url === "string" ? data.ticket_url : null),
    event_context: {
      event_name:
        input.event_context?.event_name ??
        (typeof data.name === "string" ? data.name : null),
      country:
        input.event_context?.country ??
        (typeof data.country_code === "string" ? data.country_code : null),
      city:
        input.event_context?.city ??
        (typeof data.city === "string" ? data.city : null),
      venue:
        input.event_context?.venue ??
        (typeof data.venue === "string" ? data.venue : null),
      date:
        input.event_context?.date ??
        (typeof data.date === "string" ? data.date : null),
    },
  };
}

export async function lookupCanonicalArtist(
  supabase: SupabaseClient,
  artistName: string,
): Promise<ArtistRow | null> {
  const local = await lookupLocalArtist(supabase, artistName);
  return local.artist;
}

export async function normalizeArtist(
  supabase: SupabaseClient,
  input: NormalizationInput,
  options: ResolveOptions = { action: "normalize" },
): Promise<NormalizationResult> {
  const artistName = input.artist_name?.trim() ?? "";
  const sortedSignals = dedupe([
    ...(input.raw_genres ?? []),
    ...(input.raw_tags ?? []),
  ]).sort();
  const cacheKey = `normalize:v1:${normalizeText(artistName)}:${await sha256(JSON.stringify(sortedSignals))}`;

  if (!input.force_refresh) {
    const cached = await getCacheEntry(supabase, cacheKey);
    if (cached) {
      return {
        ...cached,
        trace: {
          ...cached.trace,
          cache_hit: true,
          cache_key: cacheKey,
        },
      };
    }
  }

  const runId = await createRun(supabase, input, options.action, cacheKey);

  try {
    if (input.persist !== false) {
      await recordRawInput(supabase, input);
    }

    const artistResolution = await resolveArtistIdentity(supabase, input);
    const genreResolution = await resolveGenres(
      supabase,
      input,
      artistResolution.artist,
      artistResolution.supplementalSignals,
    );
    const selectedGenres = chooseTopGenres(genreResolution.genres);

    if (artistResolution.artist?.id && input.persist !== false) {
      await persistGenreLinks(supabase, artistResolution.artist.id, selectedGenres);
    }

    const sourceScores = [
      ...artistResolution.evidence.map((entry) => entry.score),
      ...genreResolution.evidence.map((entry) => entry.score),
    ];
    const confidence = sourceScores.length
      ? Number((sourceScores.reduce((sum, value) => sum + value, 0) / sourceScores.length).toFixed(4))
      : 0;
    const status = confidenceToStatus(confidence);
    const reviewRequired = status === "ambiguous" || status === "unresolved" || genreResolution.unmapped.length > 0;

    const resultWithoutTrace = {
      status,
      artist: {
        id: artistResolution.artist?.id ?? null,
        canonical_name: artistResolution.artist?.name ?? null,
        musicbrainz_id: artistResolution.artist?.musicbrainz_id ?? null,
        matched_alias: artistResolution.matchedAlias,
      },
      genres: selectedGenres,
      confidence,
      review_required: reviewRequired,
      discarded_tags: genreResolution.discarded,
      unmapped_signals: genreResolution.unmapped,
      sources: [
        ...artistResolution.evidence,
        ...genreResolution.evidence,
      ].map((entry) => ({
        provider: entry.provider,
        used_for: entry.used_for,
        score: entry.score,
        provider_entity_id: entry.provider_entity_id ?? null,
      })),
    };

    await insertEvidence(supabase, runId, [
      ...artistResolution.evidence,
      ...genreResolution.evidence,
    ]);

    if (reviewRequired) {
      await enqueueReview(
        supabase,
        runId,
        input.event_id ? "event" : "artist",
        genreResolution.unmapped.length > 0 ? "unmapped_signals" : status,
        {
          input,
          result: resultWithoutTrace,
        },
      );
    }

    const result: NormalizationResult = {
      ...resultWithoutTrace,
      trace: {
        cache_hit: false,
        cache_key: cacheKey,
        run_id: runId,
      },
    };

    await finishRun(
      supabase,
      runId,
      resultWithoutTrace,
      dedupe(result.sources.map((source) => source.provider)),
    );
    await putCacheEntry(supabase, cacheKey, input, result);

    if (!result.review_required) {
      await resolveMatchingReviewItems(supabase, input);
    }

    return result;
  } catch (error) {
    await failRun(
      supabase,
      runId,
      errorMessage(error),
    );
    throw error;
  }
}

async function createMissingArtistResult(
  supabase: SupabaseClient,
  input: NormalizationInput,
): Promise<NormalizationResult> {
  const cacheKey = `classify:v1:${input.event_id ?? slugify(input.event_context?.event_name ?? "unknown")}:missing-artist`;
  const runId = await createRun(supabase, input, "classify", cacheKey);

  const resultWithoutTrace = {
    status: "unresolved" as const,
    artist: {
      id: null,
      canonical_name: null,
      musicbrainz_id: null,
      matched_alias: null,
    },
    genres: [],
    confidence: 0,
    review_required: true,
    discarded_tags: [],
    unmapped_signals: [],
    sources: [],
  };

  await enqueueReview(supabase, runId, input.event_id ? "event" : "artist", "missing_artist", {
    input,
    result: resultWithoutTrace,
  });
  await finishRun(supabase, runId, resultWithoutTrace, []);

  return {
    ...resultWithoutTrace,
    trace: {
      cache_hit: false,
      cache_key: cacheKey,
      run_id: runId,
    },
  };
}

export async function classifyEventFromLineup(
  supabase: SupabaseClient,
  input: NormalizationInput,
): Promise<NormalizationResult> {
  const hydratedInput = await hydrateClassificationInput(supabase, input);
  const lineup = dedupe(
    (hydratedInput.lineup ?? []).map((name) => name.trim()).filter(Boolean),
  );

  const primaryArtist = hydratedInput.artist_name?.trim() || lineup[0] || null;
  if (!primaryArtist) {
    return createMissingArtistResult(supabase, hydratedInput);
  }

  const baseResult = await normalizeArtist(supabase, {
    ...hydratedInput,
    artist_name: primaryArtist,
  }, { action: "classify" });

  const normalizedArtistIds = baseResult.artist.id ? [baseResult.artist.id] : [];

  if (hydratedInput.event_id && hydratedInput.persist !== false && baseResult.genres.length) {
    await persistEventClassification(
      supabase,
      hydratedInput.event_id,
      baseResult.trace.run_id,
      baseResult.genres,
      normalizedArtistIds,
      baseResult.confidence,
    );
  }

  return baseResult;
}

async function selectEventsForBatch(
  supabase: SupabaseClient,
  options: ClassifyEventsBatchInput,
): Promise<EventRowForClassification[]> {
  const requestedLimit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const fetchLimit = Math.min(Math.max(requestedLimit * 4, 60), 400);

  let query = supabase
    .from("events")
    .select(`
      id,
      name,
      description,
      lineup,
      event_artists (
        order_index,
        artists ( name )
      ),
      source,
      ticket_url,
      city,
      country_code,
      venue,
      date,
      is_active,
      event_genres ( genre_id )
    `)
    .eq("is_active", true)
    .order("date", { ascending: true })
    .limit(fetchLimit);

  if (options.source) query = query.eq("source", options.source);
  if (options.date_from) query = query.gte("date", options.date_from);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as EventRowForClassification[];
  const recentAttemptedEventIds = new Set<string>();
  const excludedEventIds = new Set(
    Array.isArray(options.exclude_event_ids)
      ? options.exclude_event_ids.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [],
  );

  if (!options.force_refresh) {
    const { data: recentRuns } = await supabase
      .schema("normalization")
      .from("runs")
      .select("input_payload, created_at, status")
      .eq("entity_type", "event")
      .order("created_at", { ascending: false })
      .limit(400);

    const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 7;
    for (const row of (recentRuns ?? []) as Array<{
      input_payload?: Record<string, unknown> | null;
      created_at?: string | null;
      status?: string | null;
    }>) {
      if (!row.created_at || Number.isNaN(Date.parse(row.created_at))) continue;
      if (Date.parse(row.created_at) < cutoff) continue;
      const payload = row.input_payload ?? {};
      const eventId = typeof payload.event_id === "string" ? payload.event_id : null;
      if (!eventId) continue;
      recentAttemptedEventIds.add(eventId);
    }
  }

  function scoreEvent(row: EventRowForClassification): number {
    const linkedArtistNames = extractArtistNamesFromLinks(row.event_artists);
    const lineupValues = extractLineupValues(row.lineup);
    const derivedCandidates = deriveArtistCandidates({
      eventName: row.name,
      description: row.description,
      linkedArtistNames,
      lineupValues,
    });
    const inferredArtists = inferArtistsFromEventTitle(row.name);
    const normalizedName = normalizeText(row.name);
    const primaryInferred = derivedCandidates[0] ?? "";
    const normalizedPrimary = normalizeText(primaryInferred);
    let score = 0;

    if (linkedArtistNames.length > 0) score += 20;
    else if (lineupValues.length > 0) score += 12;
    else if (deriveArtistCandidates({
      eventName: row.name,
      description: row.description,
      linkedArtistNames: [],
      lineupValues: [],
    }).length > 0) score += 4;

    if (derivedCandidates.length === 1) score += 12;
    else if (derivedCandidates.length > 1) score += 5;
    else score -= 14;

    if (normalizedPrimary && normalizedPrimary === normalizedName) score += 8;
    if (normalizedPrimary && normalizedPrimary.split(" ").length <= 3) score += 5;
    else if (normalizedPrimary && normalizedPrimary.split(" ").length <= 5) score += 2;
    else if (normalizedPrimary) score -= 3;

    if (normalizedName && normalizedName.split(" ").length <= 4) score += 4;
    if (/^(presenta|pres\.)/i.test(row.name ?? "")) score -= 4;
    if (/^(tributo a|homenaje a)/i.test(row.name ?? "")) score -= 2;
    if (looksLikeAccessoryEvent(row.name ?? "")) score -= 20;
    if (isGenericEventTitle(row.name ?? "")) score -= 15;
    if (LOW_SIGNAL_EVENT_PATTERNS.some((pattern) => pattern.test(row.name ?? ""))) score -= 12;
    if (/\b(?:20\d{2}|\d{2}\s+anos|\d{2}\s+años)\b/i.test(row.name ?? "")) score -= 3;
    if (/[0-9]/.test(primaryInferred)) score -= 4;

    return score;
  }

  const filtered = rows.filter((row) => {
    if (excludedEventIds.has(row.id)) return false;
    if (isClearlyNonMusicalEvent(row)) return false;
    if (options.only_without_genres === false) return true;
    const withoutGenres = !Array.isArray(row.event_genres) || row.event_genres.length === 0;
    if (!withoutGenres) return false;
    if (!options.force_refresh && recentAttemptedEventIds.has(row.id)) return false;
    return true;
  });

  const scored = filtered
    .map((row) => ({ row, score: scoreEvent(row) }))
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(left.row.date ?? 0).getTime() - new Date(right.row.date ?? 0).getTime();
    });

  const preferred = scored.filter((entry) => entry.score >= 5);
  const fallback = scored.filter((entry) => entry.score < 5);

  return [...preferred, ...fallback]
    .slice(0, requestedLimit)
    .map((entry) => entry.row);
}

export async function classifyEventsBatch(
  supabase: SupabaseClient,
  options: ClassifyEventsBatchInput = {},
): Promise<ClassifyEventsBatchResult> {
  const dryRun = options.dry_run ?? false;
  const selectedEvents = await selectEventsForBatch(supabase, options);
  const results: ClassifyEventsBatchResult["results"] = [];

  let countProcessed = 0;
  let countClassified = 0;
  let countAmbiguous = 0;
  let countSkippedNoArtist = 0;
  let countFailed = 0;

  const perEventResults = await mapWithConcurrency(selectedEvents, 4, async (event) => {
    try {
      const result = await classifyEventFromLineup(supabase, {
        event_id: event.id,
        source_platform: event.source,
        source_url: event.ticket_url,
        event_context: {
          event_name: event.name,
          city: event.city,
          country: event.country_code,
          venue: event.venue,
          date: event.date,
        },
        persist: !dryRun,
        force_refresh: options.force_refresh ?? false,
      });
      const eventStatus =
        result.genres.length === 0 && (!result.artist.id || result.status === "unresolved")
          ? "skipped_no_artist"
          : result.genres.length > 0 &&
              (result.status === "matched" || result.status === "matched_low_confidence")
          ? "classified"
          : "ambiguous";
      const reviewReasonCode =
        !result.artist.id && result.status === "unresolved"
          ? "missing_artist"
          : result.unmapped_signals.length > 0
            ? "unmapped_signals"
            : result.status === "ambiguous"
              ? "ambiguous_confidence"
              : result.status === "unresolved"
                ? "unresolved_artist"
                : result.review_required
                  ? "manual_review"
                  : undefined;

      return {
        event_id: event.id,
        event_name: event.name,
        inferred_artists: deriveArtistCandidates({
          eventName: event.name,
          description: event.description,
          linkedArtistNames: extractArtistNamesFromLinks(event.event_artists),
          lineupValues: extractLineupValues(event.lineup),
        }),
        status: eventStatus,
        normalization_status: result.status,
        genres: result.genres.map((genre) => genre.genre_slug),
        confidence: result.confidence,
        review_required: result.review_required,
        review_reason_code: isClearlyNonMusicalEvent(event) ? "editorial_non_music" : reviewReasonCode,
        unmapped_signals: result.unmapped_signals,
        discarded_tags: result.discarded_tags,
        source_providers: dedupe(result.sources.map((source) => source.provider)),
      } as NonNullable<ClassifyEventsBatchResult["results"]>[number];
    } catch (error) {
      return {
        event_id: event.id,
        event_name: event.name,
        inferred_artists: deriveArtistCandidates({
          eventName: event.name,
          description: event.description,
          linkedArtistNames: extractArtistNamesFromLinks(event.event_artists),
          lineupValues: extractLineupValues(event.lineup),
        }),
        status: "failed",
        genres: [],
        error: errorMessage(error),
      } as NonNullable<ClassifyEventsBatchResult["results"]>[number];
    }
  });

  for (const item of perEventResults) {
    countProcessed += 1;
    if (item.status === "classified") countClassified += 1;
    if (item.status === "ambiguous") countAmbiguous += 1;
    if (item.status === "skipped_no_artist") countSkippedNoArtist += 1;
    if (item.status === "failed") countFailed += 1;

    if (dryRun || selectedEvents.length <= 25) {
      results?.push(item);
    }
  }

  return {
    count_selected: selectedEvents.length,
    count_processed: countProcessed,
    count_classified: countClassified,
    count_ambiguous: countAmbiguous,
    count_skipped_no_artist: countSkippedNoArtist,
    count_failed: countFailed,
    dry_run: dryRun,
    results: dryRun || selectedEvents.length <= 25 ? results : undefined,
  };
}

function startOfLimaDayUtcIso(): string {
  const now = new Date();
  const start = new Date(now);
  if (start.getUTCHours() < 5) {
    start.setUTCDate(start.getUTCDate() - 1);
  }
  start.setUTCHours(5, 0, 0, 0);
  return start.toISOString();
}

export async function getNormalizationOverview(
  supabase: SupabaseClient,
): Promise<NormalizationOverview> {
  const { count: openReviewCount } = await supabase
    .schema("normalization")
    .from("review_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  const { count: openMissingArtistCount } = await supabase
    .schema("normalization")
    .from("review_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .eq("reason_code", "missing_artist");

  const { count: openUnresolvedArtistCount } = await supabase
    .schema("normalization")
    .from("review_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .in("reason_code", ["missing_artist", "unresolved_artist"]);

  const { count: classifiedTodayCount } = await supabase
    .schema("normalization")
    .from("event_classifications")
    .select("id", { count: "exact", head: true })
    .gte("updated_at", startOfLimaDayUtcIso());

  const { data: recentRuns } = await supabase
    .schema("normalization")
    .from("runs")
    .select("result_payload")
    .order("created_at", { ascending: false })
    .limit(250);

  const unmappedSignalCounts = new Map<string, number>();
  for (const row of (recentRuns ?? []) as Array<{ result_payload?: Record<string, unknown> | null }>) {
    const resultPayload = row.result_payload ?? {};
    const unmappedSignals = Array.isArray(resultPayload.unmapped_signals)
      ? resultPayload.unmapped_signals
      : [];

    for (const signal of unmappedSignals) {
      if (typeof signal !== "string" || !signal.trim()) continue;
      const normalizedSignal = normalizeText(signal);
      if (!normalizedSignal) continue;
      if (OVERVIEW_SIGNAL_BLACKLIST.has(normalizedSignal)) continue;
      if (normalizedSignal.length <= 2) continue;
      unmappedSignalCounts.set(
        normalizedSignal,
        (unmappedSignalCounts.get(normalizedSignal) ?? 0) + 1,
      );
    }
  }

  const topUnmappedSignals = [...unmappedSignalCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([signal, total]) => ({ signal, total }));

  return {
    classified_today_count: classifiedTodayCount ?? 0,
    open_review_count: openReviewCount ?? 0,
    open_missing_artist_count: openMissingArtistCount ?? 0,
    open_unresolved_artist_count: openUnresolvedArtistCount ?? 0,
    top_unmapped_signals: topUnmappedSignals,
  };
}
