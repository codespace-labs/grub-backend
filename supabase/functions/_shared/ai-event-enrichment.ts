import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { scrapeMarkdown } from "./firecrawl.ts";
import { getEditorialExclusionReason } from "./music-filter.ts";
import {
  searchDiscogsArtist,
  searchMusicBrainzArtist,
  searchSpotifyArtist,
} from "./music-provider-clients.ts";
import { inferArtistsFromEventTitle } from "./music-normalization-service.ts";
import { validatePrice } from "./normalizer.ts";

const AI_ENRICHMENT_API_URL = Deno.env.get("AI_ENRICHMENT_API_URL") ?? "";
const AI_ENRICHMENT_API_KEY = Deno.env.get("AI_ENRICHMENT_API_KEY") ?? "";
const AI_ENRICHMENT_MODEL = Deno.env.get("AI_ENRICHMENT_MODEL") ?? "";
const AI_ENRICHMENT_PROVIDER = Deno.env.get("AI_ENRICHMENT_PROVIDER") ?? "openai-compatible";

// Cadena de fallback automático: Gemini → Groq → Cerebras
const AI_FALLBACK_API_URL = Deno.env.get("AI_FALLBACK_API_URL") ?? "";
const AI_FALLBACK_API_KEY = Deno.env.get("AI_FALLBACK_API_KEY") ?? "";
const AI_FALLBACK_MODEL = Deno.env.get("AI_FALLBACK_MODEL") ?? "";
const AI_FALLBACK_PROVIDER = Deno.env.get("AI_FALLBACK_PROVIDER") ?? "";
const AI_FALLBACK2_API_URL = Deno.env.get("AI_FALLBACK2_API_URL") ?? "";
const AI_FALLBACK2_API_KEY = Deno.env.get("AI_FALLBACK2_API_KEY") ?? "";
const AI_FALLBACK2_MODEL = Deno.env.get("AI_FALLBACK2_MODEL") ?? "";
const AI_FALLBACK2_PROVIDER = Deno.env.get("AI_FALLBACK2_PROVIDER") ?? "";
const XAI_API_KEY = Deno.env.get("XAI_API_KEY") ?? "";
const XAI_MODEL = Deno.env.get("XAI_MODEL") ?? "";
const XAI_API_URL = Deno.env.get("XAI_API_URL") ?? "https://api.x.ai/v1/chat/completions";
const AI_ENRICHMENT_DEBUG = Deno.env.get("AI_ENRICHMENT_DEBUG") === "true";

const DESCRIPTION_CONFIDENCE_THRESHOLD = 0.75;
const LINEUP_CONFIDENCE_THRESHOLD = 0.78;
const GENRES_CONFIDENCE_THRESHOLD = 0.8;
const PRICE_CONFIDENCE_THRESHOLD = 0.9;
const AI_PROVIDER_MAX_RETRIES = 4;
const AI_PROVIDER_BASE_BACKOFF_MS = 1_500;
const AI_PROVIDER_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_MARKDOWN_CHARS = 7_000;
const GROQ_MAX_MARKDOWN_CHARS = 5_000;
const GROQ_INTER_EVENT_DELAY_MS = 1_500;
const AI_PROVIDER_INTER_EVENT_DELAY_MS = Number(
  Deno.env.get("AI_ENRICHMENT_INTER_EVENT_DELAY_MS") ?? `${GROQ_INTER_EVENT_DELAY_MS}`,
);

interface EventGenreRef {
  id?: string | number | null;
  slug?: string | null;
  name?: string | null;
  canonical_slug?: string | null;
}

interface EventGenreRow {
  genre_id?: string | number | null;
  genres?: EventGenreRef | null;
}

interface EventCandidateRow {
  id: string;
  name: string | null;
  description: string | null;
  lineup: string[] | null;
  venue: string | null;
  city: string | null;
  country_code: string | null;
  source: string | null;
  ticket_url: string | null;
  date: string | null;
  start_time: string | null;
  price_min: number | null;
  price_max: number | null;
  is_active: boolean | null;
  pipeline_excluded: boolean | null;
  event_genres?: EventGenreRow[] | null;
}

interface GenreCatalogEntry {
  id: number;
  slug: string;
  name: string;
  canonical_slug: string | null;
}

interface GenreSynonymEntry {
  normalized_value: string;
  genre_id: number;
}

interface ExternalArtistContext {
  artist_name: string;
  spotify_genres: string[];
  musicbrainz_tags: string[];
  discogs_genres: string[];
  discogs_styles: string[];
  source_providers: string[];
}

interface AiFieldProposal<T> {
  value: T | null;
  confidence: number | null;
  evidence?: string | null;
}

interface AiEventProposal {
  summary: string | null;
  confidence: number | null;
  fields: {
    description?: AiFieldProposal<string>;
    lineup?: AiFieldProposal<string[]>;
    genres?: AiFieldProposal<string[]>;
    price_min?: AiFieldProposal<number>;
    price_max?: AiFieldProposal<number>;
  };
}

export interface EnrichmentBatchInput {
  limit?: number;
  dry_run?: boolean;
  only_incomplete?: boolean;
  force_refresh?: boolean;
  source?: string | null;
  exclude_event_ids?: string[];
  event_ids?: string[];
}

export interface EnrichmentBatchResult {
  count_selected: number;
  count_processed: number;
  count_applied: number;
  count_review: number;
  count_skipped: number;
  count_failed: number;
  dry_run: boolean;
  results: Array<{
    event_id: string;
    event_name: string | null;
    status: "applied" | "review" | "skipped" | "failed";
    applied_fields: string[];
    proposed_fields: string[];
    confidence: number | null;
    review_required: boolean;
    error?: string;
  }>;
}

interface ComputedPatch {
  eventPatch: {
    description?: string;
    lineup?: string[];
    price_min?: number;
    price_max?: number;
  };
  genreIds: number[];
  appliedFields: string[];
  proposedFields: string[];
  reviewRequired: boolean;
}

function ensureConfig() {
  if (isXaiProvider()) {
    if (!XAI_API_KEY || !resolveModel()) {
      throw new Error(
        "Grok/xAI no configurado. Define XAI_API_KEY y XAI_MODEL o AI_ENRICHMENT_MODEL.",
      );
    }
    return;
  }

  if (!AI_ENRICHMENT_API_URL || !AI_ENRICHMENT_API_KEY || !resolveModel()) {
    throw new Error(
      "AI enrichment no configurado. Define AI_ENRICHMENT_API_URL, AI_ENRICHMENT_API_KEY y AI_ENRICHMENT_MODEL.",
    );
  }
}

function normalizeProvider(value: string): string {
  return value.trim().toLowerCase();
}

function isXaiProvider(): boolean {
  const provider = normalizeProvider(AI_ENRICHMENT_PROVIDER);
  return provider === "xai" || provider === "grok";
}

function resolveApiUrl(): string {
  return isXaiProvider() ? XAI_API_URL : AI_ENRICHMENT_API_URL;
}

function resolveApiKey(): string {
  return isXaiProvider() ? XAI_API_KEY : AI_ENRICHMENT_API_KEY;
}

function resolveModel(): string {
  return isXaiProvider() ? (XAI_MODEL || AI_ENRICHMENT_MODEL) : AI_ENRICHMENT_MODEL;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length ? cleaned : null;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item)))];
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(message: string): number | null {
  const retryAfterMatch = message.match(/try again in\s+([\d.]+)s/i);
  if (retryAfterMatch) {
    const seconds = Number(retryAfterMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  }

  const retryAfterHeaderMatch = message.match(/retry-after[:=]\s*([\d.]+)/i);
  if (retryAfterHeaderMatch) {
    const seconds = Number(retryAfterHeaderMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  }

  return null;
}

function isGroqProvider(): boolean {
  return normalizeProvider(AI_ENRICHMENT_PROVIDER) === "groq";
}

function interEventDelayMs(): number {
  if (Number.isFinite(AI_PROVIDER_INTER_EVENT_DELAY_MS) && AI_PROVIDER_INTER_EVENT_DELAY_MS >= 0) {
    return AI_PROVIDER_INTER_EVENT_DELAY_MS;
  }
  if (isGroqProvider()) return GROQ_INTER_EVENT_DELAY_MS;
  return 0;
}

function maxMarkdownChars(): number {
  return isGroqProvider() ? GROQ_MAX_MARKDOWN_CHARS : DEFAULT_MAX_MARKDOWN_CHARS;
}

function shouldThrottleBetweenEvents(): boolean {
  return isGroqProvider() || interEventDelayMs() > 0;
}

function slicePageMarkdown(markdown: string): string {
  const limit = maxMarkdownChars();
  if (!Number.isFinite(limit) || limit <= 0) return markdown;
  return markdown.slice(0, limit);
}

function providerMaxTokens(): number {
  return isGroqProvider() ? 700 : 1200;
}

function providerRequestPayload(messages: Array<{ role: string; content: string }>) {
  return {
    model: resolveModel(),
    temperature: 0.1,
    max_tokens: providerMaxTokens(),
    response_format: { type: "json_object" },
    messages,
  };
}

function extractJsonText(payload: unknown): string {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};

  const direct = record.output_text;
  if (typeof direct === "string" && direct.trim()) return direct;

  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const message = (choice as Record<string, unknown>).message;
    if (!message || typeof message !== "object") continue;
    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const joined = content
        .map((part) => {
          if (!part || typeof part !== "object") return null;
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : null;
        })
        .filter((part): part is string => Boolean(part))
        .join("\n");
      if (joined.trim()) return joined;
    }
  }

  throw new Error("La respuesta del proveedor de IA no contiene texto parseable.");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const jsonLike = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(jsonLike) as Record<string, unknown>;
}

export function normalizeAiEventProposal(payload: unknown): AiEventProposal {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rawFields = root.fields && typeof root.fields === "object"
    ? root.fields as Record<string, unknown>
    : {};

  const field = <T>(
    key: string,
    parser: (value: unknown) => T | null,
  ): AiFieldProposal<T> | undefined => {
    const raw = rawFields[key];
    if (!raw || typeof raw !== "object") return undefined;
    const record = raw as Record<string, unknown>;
    const value = parser(record.value);
    return {
      value,
      confidence: toConfidence(record.confidence),
      evidence: cleanString(record.evidence),
    };
  };

  return {
    summary: cleanString(root.summary),
    confidence: toConfidence(root.confidence),
    fields: {
      description: field("description", cleanString),
      lineup: field("lineup", (value) => {
        const items = cleanStringArray(value);
        return items.length ? items : null;
      }),
      genres: field("genres", (value) => {
        const items = cleanStringArray(value);
        return items.length ? items : null;
      }),
      price_min: field("price_min", cleanNumber),
      price_max: field("price_max", cleanNumber),
    },
  };
}

function isIncompleteEvent(row: EventCandidateRow): boolean {
  const hasGenres = (row.event_genres?.length ?? 0) > 0;
  const hasLineup = Array.isArray(row.lineup) && row.lineup.length > 0;
  return !hasGenres || !hasLineup || !cleanString(row.description) || row.price_min == null || row.price_max == null;
}

async function loadGenreCatalog(supabase: SupabaseClient): Promise<{
  genres: GenreCatalogEntry[];
  synonyms: GenreSynonymEntry[];
}> {
  const [{ data: genres, error: genresError }, { data: synonyms, error: synonymsError }] = await Promise.all([
    supabase.from("genres").select("id, slug, name, canonical_slug"),
    supabase.schema("normalization").from("genre_synonyms").select("normalized_value, genre_id"),
  ]);

  if (genresError) throw new Error(`GENRES_LOOKUP failed: ${genresError.message}`);
  if (synonymsError) throw new Error(`GENRE_SYNONYMS_LOOKUP failed: ${synonymsError.message}`);

  return {
    genres: (genres ?? []) as GenreCatalogEntry[],
    synonyms: (synonyms ?? []) as GenreSynonymEntry[],
  };
}

function mapGenres(
  genres: string[],
  catalog: { genres: GenreCatalogEntry[]; synonyms: GenreSynonymEntry[] },
): number[] {
  const synonymMap = new Map<string, number[]>();
  for (const row of catalog.synonyms) {
    const key = normalizeText(row.normalized_value);
    const bucket = synonymMap.get(key) ?? [];
    bucket.push(Number(row.genre_id));
    synonymMap.set(key, bucket);
  }

  const genreMap = new Map<string, number>();
  for (const row of catalog.genres) {
    genreMap.set(normalizeText(row.slug), row.id);
    genreMap.set(normalizeText(row.name), row.id);
    if (row.canonical_slug) genreMap.set(normalizeText(row.canonical_slug), row.id);
  }

  const ids = new Set<number>();
  for (const raw of genres) {
    const key = normalizeText(raw);
    if (!key) continue;

    for (const id of synonymMap.get(key) ?? []) ids.add(id);
    const direct = genreMap.get(key);
    if (direct) ids.add(direct);
  }

  return [...ids];
}

function genreTokensFromEventRow(
  row: Pick<EventCandidateRow, "event_genres">,
  catalog: { genres: GenreCatalogEntry[]; synonyms: GenreSynonymEntry[] },
): string[] {
  const idToGenre = new Map<number, GenreCatalogEntry>();
  for (const genre of catalog.genres) {
    idToGenre.set(Number(genre.id), genre);
  }

  const tokens = new Set<string>();
  for (const item of row.event_genres ?? []) {
    const nested = item.genres;
    const slug = cleanString(nested?.slug);
    const name = cleanString(nested?.name);
    const canonicalSlug = cleanString(nested?.canonical_slug);

    if (slug) tokens.add(slug);
    if (canonicalSlug) tokens.add(canonicalSlug);
    if (name) tokens.add(name);

    const numericId = Number(item.genre_id);
    if (!Number.isNaN(numericId)) {
      const genre = idToGenre.get(numericId);
      if (genre?.slug) tokens.add(genre.slug);
      if (genre?.canonical_slug) tokens.add(genre.canonical_slug);
      if (genre?.name) tokens.add(genre.name);
    }
  }

  return [...tokens];
}

function normalizeGenreDecisionValue(
  value: unknown,
  catalog: { genres: GenreCatalogEntry[]; synonyms: GenreSynonymEntry[] },
): unknown {
  if (!Array.isArray(value)) return value;

  const idToGenre = new Map<number, GenreCatalogEntry>();
  for (const genre of catalog.genres) {
    idToGenre.set(Number(genre.id), genre);
  }

  return value.map((item) => {
    const numericId = typeof item === "number"
      ? item
      : typeof item === "string" && /^\d+$/.test(item.trim())
        ? Number(item.trim())
        : null;

    if (numericId == null) return item;
    const genre = idToGenre.get(numericId);
    return genre?.slug ?? genre?.canonical_slug ?? genre?.name ?? item;
  });
}

function bestNameMatch<T extends { name?: string; title?: string }>(
  candidates: T[],
  artistName: string,
): T | null {
  const target = normalizeText(artistName);
  if (!target) return candidates[0] ?? null;

  const exact = candidates.find((candidate) => normalizeText(candidate.name ?? candidate.title ?? "") === target);
  if (exact) return exact;

  const partial = candidates.find((candidate) => {
    const value = normalizeText(candidate.name ?? candidate.title ?? "");
    return value.includes(target) || target.includes(value);
  });
  return partial ?? candidates[0] ?? null;
}

async function gatherExternalArtistContext(
  row: EventCandidateRow,
): Promise<ExternalArtistContext[]> {
  const artistCandidates = [...new Set([
    ...(row.lineup ?? []),
    ...inferArtistsFromEventTitle(row.name),
  ].map((value) => value.trim()).filter(Boolean))].slice(0, 3);

  const contexts: ExternalArtistContext[] = [];

  for (const artistName of artistCandidates) {
    try {
      const [spotifyCandidates, musicBrainzCandidates, discogsCandidates] = await Promise.all([
        searchSpotifyArtist(artistName).catch(() => []),
        searchMusicBrainzArtist(artistName).catch(() => []),
        searchDiscogsArtist(artistName).catch(() => []),
      ]);

      const spotify = bestNameMatch(spotifyCandidates, artistName);
      const musicBrainz = bestNameMatch(musicBrainzCandidates, artistName);
      const discogs = bestNameMatch(discogsCandidates, artistName);

      const sourceProviders = [
        spotify ? "spotify" : null,
        musicBrainz ? "musicbrainz" : null,
        discogs ? "discogs" : null,
      ].filter((value): value is string => Boolean(value));

      if (sourceProviders.length === 0) continue;

      contexts.push({
        artist_name: artistName,
        spotify_genres: spotify?.genres ?? [],
        musicbrainz_tags: musicBrainz?.tags ?? [],
        discogs_genres: discogs?.genres ?? [],
        discogs_styles: discogs?.styles ?? [],
        source_providers: sourceProviders,
      });
    } catch (error) {
      console.warn("[ai-event-enrichment] external artist context failed", artistName, error);
    }
  }

  return contexts;
}

function buildExternalGenreDecision(
  row: EventCandidateRow,
  contexts: ExternalArtistContext[],
  catalog: { genres: GenreCatalogEntry[]; synonyms: GenreSynonymEntry[] },
): AiJudgeDecision | null {
  if ((row.event_genres?.length ?? 0) > 0 || contexts.length === 0) return null;

  const sourceSignals = new Map<number, Set<string>>();
  for (const context of contexts) {
    const providerSignals = [
      ...context.spotify_genres.map((signal) => ({ signal, provider: "spotify" })),
      ...context.musicbrainz_tags.map((signal) => ({ signal, provider: "musicbrainz" })),
      ...context.discogs_genres.map((signal) => ({ signal, provider: "discogs" })),
      ...context.discogs_styles.map((signal) => ({ signal, provider: "discogs" })),
    ];

    for (const { signal, provider } of providerSignals) {
      const ids = mapGenres([signal], catalog);
      for (const id of ids) {
        const providers = sourceSignals.get(id) ?? new Set<string>();
        providers.add(provider);
        sourceSignals.set(id, providers);
      }
    }
  }

  const ranked = [...sourceSignals.entries()]
    .map(([genreId, providers]) => ({ genreId, providers, score: providers.size }))
    .sort((left, right) => right.score - left.score);

  const top = ranked[0];
  if (!top) return null;

  const genre = catalog.genres.find((item) => item.id === top.genreId);
  if (!genre) return null;

  const confidence = top.providers.size >= 2 ? 0.9 : 0.76;
  const action: JudgeAction = top.providers.size >= 2 ? "completar" : "dudoso";

  return {
    field: "genres",
    action,
    current_value: null,
    proposed_value: [genre.slug],
    reason: top.providers.size >= 2
      ? `Se completó el género usando consenso externo del artista en ${[...top.providers].join(", ")}.`
      : `Se encontró una señal parcial de género del artista en ${[...top.providers].join(", ")}, pero requiere revisión humana.`,
    evidence: contexts
      .map((context) => `${context.artist_name}: ${[...context.spotify_genres, ...context.musicbrainz_tags, ...context.discogs_genres, ...context.discogs_styles].slice(0, 4).join(", ")}`)
      .filter(Boolean)
      .join(" | ") || null,
    confidence,
  };
}

export function computeEnrichmentPatch(
  row: EventCandidateRow,
  proposal: AiEventProposal,
  mappedGenreIds: number[],
): ComputedPatch {
  const patch: ComputedPatch = {
    eventPatch: {},
    genreIds: [],
    appliedFields: [],
    proposedFields: [],
    reviewRequired: false,
  };

  const existingGenres = new Set(
    (row.event_genres ?? [])
      .map((item) => item.genre_id)
      .filter((item): item is string | number => item != null)
      .map((item) => Number(item)),
  );

  const addProposed = (field: string, shouldApply: boolean) => {
    patch.proposedFields.push(field);
    if (shouldApply) patch.appliedFields.push(field);
    else patch.reviewRequired = true;
  };

  const description = proposal.fields.description;
  if (!cleanString(row.description) && description?.value) {
    const shouldApply = (description.confidence ?? 0) >= DESCRIPTION_CONFIDENCE_THRESHOLD && description.value.length >= 40;
    addProposed("description", shouldApply);
    if (shouldApply) patch.eventPatch.description = description.value;
  }

  const lineup = proposal.fields.lineup;
  if ((!row.lineup || row.lineup.length === 0) && lineup?.value?.length) {
    const shouldApply = (lineup.confidence ?? 0) >= LINEUP_CONFIDENCE_THRESHOLD;
    addProposed("lineup", shouldApply);
    if (shouldApply) patch.eventPatch.lineup = lineup.value;
  }

  const priceMin = proposal.fields.price_min;
  if (row.price_min == null && priceMin?.value != null) {
    const validated = validatePrice(priceMin.value);
    const shouldApply = validated != null && (priceMin.confidence ?? 0) >= PRICE_CONFIDENCE_THRESHOLD;
    addProposed("price_min", shouldApply);
    if (shouldApply && validated != null) patch.eventPatch.price_min = validated;
  }

  const priceMax = proposal.fields.price_max;
  if (row.price_max == null && priceMax?.value != null) {
    const validated = validatePrice(priceMax.value);
    const candidateMin = patch.eventPatch.price_min ?? row.price_min ?? null;
    const shouldApply = validated != null &&
      (priceMax.confidence ?? 0) >= PRICE_CONFIDENCE_THRESHOLD &&
      (candidateMin == null || validated >= candidateMin);
    addProposed("price_max", shouldApply);
    if (shouldApply && validated != null) patch.eventPatch.price_max = validated;
  }

  const genres = proposal.fields.genres;
  if (existingGenres.size === 0 && genres?.value?.length) {
    const candidateIds = mappedGenreIds.filter((id) => !existingGenres.has(id));
    const shouldApply = candidateIds.length > 0 && (genres.confidence ?? 0) >= GENRES_CONFIDENCE_THRESHOLD;
    addProposed("genres", shouldApply);
    if (shouldApply) patch.genreIds = candidateIds;
  }

  return patch;
}

async function fetchEventCandidates(
  supabase: SupabaseClient,
  options: EnrichmentBatchInput,
): Promise<EventCandidateRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const includeEventIds = [...new Set((options.event_ids ?? []).filter(Boolean))];
  const excludedIds = new Set(options.exclude_event_ids ?? []);
  const pageSize = 250;
  const maxScan = includeEventIds.length > 0 ? includeEventIds.length : 5000;
  const rows: EventCandidateRow[] = [];

  if (includeEventIds.length > 0) {
    let query = supabase
      .from("events")
      .select("id, name, description, lineup, venue, city, country_code, source, ticket_url, date, start_time, price_min, price_max, is_active, pipeline_excluded, event_genres(genre_id, genres(id, slug, name, canonical_slug))")
      .order("date", { ascending: true })
      .in("id", includeEventIds)
      .eq("pipeline_excluded", false);

    if (options.source) query = query.eq("source", options.source);

    const { data, error } = await query;
    if (error) throw new Error(`EVENT_CANDIDATES_LOOKUP failed: ${error.message}`);
    rows.push(...((data ?? []) as EventCandidateRow[]));
  } else {
    for (let offset = 0; offset < maxScan; offset += pageSize) {
      let query = supabase
        .from("events")
        .select("id, name, description, lineup, venue, city, country_code, source, ticket_url, date, start_time, price_min, price_max, is_active, pipeline_excluded, event_genres(genre_id, genres(id, slug, name, canonical_slug))")
        .order("date", { ascending: true })
        .eq("is_active", true)
        .eq("pipeline_excluded", false)
        .range(offset, offset + pageSize - 1);

      if (options.source) query = query.eq("source", options.source);

      const { data, error } = await query;
      if (error) throw new Error(`EVENT_CANDIDATES_LOOKUP failed: ${error.message}`);

      const pageRows = (data ?? []) as EventCandidateRow[];
      if (pageRows.length === 0) break;
      rows.push(...pageRows);
      if (pageRows.length < pageSize) break;
    }
  }

  return rows
    .filter((row) => !excludedIds.has(row.id))
    .filter((row) => row.pipeline_excluded !== true)
    .filter((row) => options.only_incomplete === false ? true : isIncompleteEvent(row))
    .filter((row) => Boolean(row.ticket_url))
    .slice(0, includeEventIds.length > 0 ? includeEventIds.length : limit);
}

async function callAiProvider(input: Record<string, unknown>): Promise<AiEventProposal> {
  ensureConfig();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= AI_PROVIDER_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(resolveApiUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resolveApiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(providerRequestPayload([
          {
            role: "system",
            content: ENRICHMENT_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ])),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const message = `AI_PROVIDER_ERROR ${response.status}: ${body.slice(0, 500)}`;
        if (response.status === 429 && attempt < AI_PROVIDER_MAX_RETRIES) {
          const retryMs = parseRetryDelayMs(message) ?? (AI_PROVIDER_BASE_BACKOFF_MS * (attempt + 1));
          console.warn(`[ai-event-enrichment] rate limited, retrying in ${retryMs}ms`);
          await sleep(retryMs);
          continue;
        }
        throw new Error(message);
      }

      const payload = await response.json();
      if (AI_ENRICHMENT_DEBUG) {
        console.log("[ai-event-enrichment] provider payload", JSON.stringify(payload).slice(0, 4000));
      }
      const jsonText = extractJsonText(payload);
      if (AI_ENRICHMENT_DEBUG) {
        console.log("[ai-event-enrichment] extracted json text", jsonText.slice(0, 4000));
      }
      return normalizeAiEventProposal(parseJsonObject(jsonText));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < AI_PROVIDER_MAX_RETRIES && /AI_PROVIDER_ERROR 429/.test(lastError.message)) {
        const retryMs = parseRetryDelayMs(lastError.message) ?? (AI_PROVIDER_BASE_BACKOFF_MS * (attempt + 1));
        console.warn(`[ai-event-enrichment] provider 429 caught, retrying in ${retryMs}ms`);
        await sleep(retryMs);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("AI provider failed after retries");
}

async function writeEnrichmentLog(
  supabase: SupabaseClient,
  payload: {
    event_id: string;
    status: "pending" | "applied" | "review" | "skipped" | "failed";
    confidence?: number | null;
    review_required?: boolean;
    input_payload: Record<string, unknown>;
    proposed_patch?: Record<string, unknown> | null;
    applied_patch?: Record<string, unknown> | null;
    error_message?: string | null;
  },
) {
  const { error } = await supabase
    .schema("normalization")
    .from("ai_event_enrichments")
    .insert({
      event_id: payload.event_id,
      provider: isXaiProvider() ? "xai" : AI_ENRICHMENT_PROVIDER,
      model: resolveModel(),
      status: payload.status,
      confidence: payload.confidence ?? null,
      review_required: payload.review_required ?? false,
      input_payload: payload.input_payload,
      proposed_patch: payload.proposed_patch ?? null,
      applied_patch: payload.applied_patch ?? null,
      error_message: payload.error_message ?? null,
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });

  if (error) {
    console.error("[ai-event-enrichment] log insert failed", error);
  }
}

async function applyPatch(
  supabase: SupabaseClient,
  row: EventCandidateRow,
  patch: ComputedPatch,
  dryRun: boolean,
) {
  if (dryRun) return;

  if (Object.keys(patch.eventPatch).length > 0) {
    const { error } = await supabase
      .from("events")
      .update(patch.eventPatch)
      .eq("id", row.id);

    if (error) throw new Error(`EVENT_PATCH failed for ${row.id}: ${error.message}`);
  }

  if (patch.genreIds.length > 0) {
    const { error } = await supabase
      .from("event_genres")
      .upsert(
        patch.genreIds.map((genreId) => ({
          event_id: row.id,
          genre_id: genreId,
        })),
        { onConflict: "event_id,genre_id", ignoreDuplicates: true },
      );

    if (error) throw new Error(`EVENT_GENRES_PATCH failed for ${row.id}: ${error.message}`);
  }
}

async function enrichSingleEvent(
  supabase: SupabaseClient,
  row: EventCandidateRow,
  catalog: { genres: GenreCatalogEntry[]; synonyms: GenreSynonymEntry[] },
  dryRun: boolean,
): Promise<EnrichmentBatchResult["results"][number]> {
  try {
    if (!row.ticket_url) {
      return {
        event_id: row.id,
        event_name: row.name,
        status: "skipped",
        applied_fields: [],
        proposed_fields: [],
        confidence: null,
        review_required: false,
      };
    }

    const markdown = await scrapeMarkdown(row.ticket_url, { waitFor: 1500 });
    const inputPayload = {
      event: {
        id: row.id,
        name: row.name,
        description: row.description,
        lineup: row.lineup ?? [],
        venue: row.venue,
        city: row.city,
        country_code: row.country_code,
        source: row.source,
        ticket_url: row.ticket_url,
        date: row.date,
        start_time: row.start_time,
        price_min: row.price_min,
        price_max: row.price_max,
        genre_ids: (row.event_genres ?? []).map((item) => item.genre_id).filter(Boolean),
      },
      page_markdown: slicePageMarkdown(markdown.markdown),
    };

    const proposal = await callAiProvider(inputPayload);
    const mappedGenreIds = mapGenres(proposal.fields.genres?.value ?? [], catalog);
    const patch = computeEnrichmentPatch(row, proposal, mappedGenreIds);

    if (AI_ENRICHMENT_DEBUG) {
      console.log("[ai-event-enrichment] normalized proposal", JSON.stringify(proposal));
      console.log("[ai-event-enrichment] computed patch", JSON.stringify(patch));
    }

    const proposedPatch = {
      summary: proposal.summary,
      confidence: proposal.confidence,
      fields: proposal.fields,
      mapped_genre_ids: mappedGenreIds,
    };

    if (patch.appliedFields.length === 0 && patch.proposedFields.length === 0) {
      await writeEnrichmentLog(supabase, {
        event_id: row.id,
        status: "skipped",
        confidence: proposal.confidence,
        review_required: false,
        input_payload: inputPayload,
        proposed_patch: proposedPatch,
      });
      return {
        event_id: row.id,
        event_name: row.name,
        status: "skipped",
        applied_fields: [],
        proposed_fields: [],
        confidence: proposal.confidence,
        review_required: false,
      };
    }

    await applyPatch(supabase, row, patch, dryRun);

    const status = patch.reviewRequired && patch.appliedFields.length === 0 ? "review" : "applied";
    await writeEnrichmentLog(supabase, {
      event_id: row.id,
      status,
      confidence: proposal.confidence,
      review_required: patch.reviewRequired,
      input_payload: inputPayload,
      proposed_patch: proposedPatch,
      applied_patch: {
        event_patch: patch.eventPatch,
        genre_ids: patch.genreIds,
        applied_fields: patch.appliedFields,
      },
    });

    return {
      event_id: row.id,
      event_name: row.name,
      status,
      applied_fields: patch.appliedFields,
      proposed_fields: patch.proposedFields,
      confidence: proposal.confidence,
      review_required: patch.reviewRequired,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected AI enrichment error";
    await writeEnrichmentLog(supabase, {
      event_id: row.id,
      status: "failed",
      review_required: false,
      input_payload: {
        event_id: row.id,
        ticket_url: row.ticket_url,
      },
      error_message: message,
    });

    return {
      event_id: row.id,
      event_name: row.name,
      status: "failed",
      applied_fields: [],
      proposed_fields: [],
      confidence: null,
      review_required: false,
      error: message,
    };
  }
}

export async function enrichEventsWithAiBatch(
  supabase: SupabaseClient,
  options: EnrichmentBatchInput = {},
): Promise<EnrichmentBatchResult> {
  ensureConfig();

  const dryRun = options.dry_run === true;
  const rows = await fetchEventCandidates(supabase, options);
  const catalog = await loadGenreCatalog(supabase);
  const results: EnrichmentBatchResult["results"] = [];

  for (const [index, row] of rows.entries()) {
    if (index > 0 && shouldThrottleBetweenEvents()) {
      await sleep(interEventDelayMs());
    }
    results.push(await enrichSingleEvent(supabase, row, catalog, dryRun));
  }

  return {
    count_selected: rows.length,
    count_processed: results.length,
    count_applied: results.filter((item) => item.status === "applied").length,
    count_review: results.filter((item) => item.review_required || item.status === "review").length,
    count_skipped: results.filter((item) => item.status === "skipped").length,
    count_failed: results.filter((item) => item.status === "failed").length,
    dry_run: dryRun,
    results,
  };
}

// ─── Judge mode ───────────────────────────────────────────────────────────────
//
// El juez revisa TODOS los campos del evento —incluso los que ya tienen valor—
// y emite un veredicto por campo: ok | completar | corregir | dudoso.
//
// Campos autocorregibles (alta confianza → se aplican automáticamente):
//   lineup, description, genres, venue, price_min, price_max
//
// Campos de solo lectura (el juez opina pero NUNCA autocorrige):
//   name, date, start_time  → siempre van a revisión humana.

type JudgeWritableField = "lineup" | "description" | "genres" | "venue" | "price_min" | "price_max";
type JudgeReadonlyField = "name" | "date" | "start_time" | "visibility";
type JudgeField = JudgeWritableField | JudgeReadonlyField;
type JudgeAction = "ok" | "completar" | "corregir" | "dudoso";

const JUDGE_WRITABLE_FIELDS = new Set<JudgeField>(
  ["lineup", "description", "genres", "venue", "price_min", "price_max"],
);

interface AiJudgeDecision {
  field: JudgeField;
  action: JudgeAction;
  current_value: unknown;
  proposed_value: unknown;
  reason: string;
  evidence: string | null;
  confidence: number | null;
}

interface AiJudgeProposal {
  summary: string | null;
  decisions: AiJudgeDecision[];
}

const ELECTRONIC_GENRE_SLUGS = new Set(["electronica", "house", "techno", "trance", "edm"]);
const ELECTRONIC_SIGNAL_TERMS = [
  "electronica",
  "electronic",
  "house",
  "tech house",
  "deep house",
  "progressive house",
  "techno",
  "hard techno",
  "melodic techno",
  "edm",
  "trance",
  "dj set",
];
const NON_ELECTRONIC_CONFLICT_TERMS = [
  "rock",
  "rock latino",
  "latin rock",
  "pop",
  "latin pop",
  "rap",
  "trap",
  "reggaeton",
  "urbano",
  "salsa",
  "cumbia",
  "folklore",
  "folclore",
  "metal",
  "punk",
  "balada",
  "criolla",
];

const VALE_TODO_DOWNTOWN_GENRE_OVERRIDE = ["reggaeton", "urbano-latino"];

export interface JudgeBatchInput {
  limit?: number;
  dry_run?: boolean;
  source?: string | null;
  exclude_event_ids?: string[];
  skip_resolved?: boolean;
  force_refresh?: boolean;
  event_ids?: string[];
}

export interface JudgeDecisionResult {
  field: JudgeField;
  action: JudgeAction;
  current_value: unknown;
  proposed_value: unknown;
  reason: string;
  evidence: string | null;
  confidence: number | null;
  auto_applied: boolean;
}

export interface JudgeBatchResult {
  count_selected: number;
  count_processed: number;
  count_corrected: number;
  count_valid: number;
  count_review: number;
  count_failed: number;
  dry_run: boolean;
  results: Array<{
    event_id: string;
    event_name: string | null;
    verdict: "corrected" | "valid" | "needs_review" | "failed";
    decisions: JudgeDecisionResult[];
    error?: string;
  }>;
}

export interface AiAuditDecisionDto {
  field: string;
  action: string;
  current_value: unknown;
  proposed_value: unknown;
  reason: string;
  evidence: string | null;
  confidence: number | null;
  auto_applied: boolean;
}

export interface AiAuditEntryDto {
  id: string;
  event_id: string;
  event_name: string | null;
  provider: string;
  model: string;
  status: "pending" | "applied" | "review" | "skipped" | "failed";
  confidence: number | null;
  review_required: boolean;
  created_at: string;
  finished_at: string | null;
  error_message: string | null;
  summary: string | null;
  decisions: AiAuditDecisionDto[];
  applied_fields: string[];
  proposed_fields: string[];
}

export interface AiAuditOverview {
  total_recent_runs: number;
  applied_recent_count: number;
  review_recent_count: number;
  failed_recent_count: number;
  entries: AiAuditEntryDto[];
}

export interface AiPromptCatalog {
  enrichment_system_prompt: string;
  judge_system_prompt: string;
}

export interface ReviewAiAuditDecisionInput {
  review_id: string;
  decision: "approve" | "reject";
  actor_user_id?: string | null;
  actor_role?: string | null;
}

interface JudgeRunRow {
  event_id: string | null;
  status: "pending" | "applied" | "review" | "skipped" | "failed" | null;
  review_required: boolean | null;
  created_at: string | null;
  proposed_patch: unknown;
}

interface AiAttemptRow {
  event_id: string | null;
  created_at: string | null;
  status?: "pending" | "applied" | "review" | "skipped" | "failed" | null;
  review_required?: boolean | null;
}

const ENRICHMENT_SYSTEM_PROMPT = `Eres un sistema de enriquecimiento de eventos musicales.

SALIDA: Solo JSON válido. Sin markdown, sin texto adicional.

CAMPOS A COMPLETAR: description, lineup, genres, price_min, price_max.
No toques ningún otro campo. Nunca inventes datos. Usa null si no hay evidencia explícita.
Moneda: PEN salvo evidencia contraria.

REGLAS DE GÉNERO:
- Nunca asumas "electronica" por palabras genéricas: fest, festival, music fest, live, party, show, concierto.
- Nunca uses "electronica" como valor por descarte o default.
- Si el evento es tributo, homenaje, aniversario o legado: el género debe venir del artista homenajeado o de evidencia explícita. No supongas.
- Si no hay evidencia suficiente para asignar género: devuelve null.

ESQUEMA DE RESPUESTA:
{
  "summary": string|null,
  "confidence": number|null,
  "fields": {
    "description":  { "value": string|null,   "confidence": number|null, "evidence": string|null },
    "lineup":       { "value": string[]|null,  "confidence": number|null, "evidence": string|null },
    "genres":       { "value": string[]|null,  "confidence": number|null, "evidence": string|null },
    "price_min":    { "value": number|null,    "confidence": number|null, "evidence": string|null },
    "price_max":    { "value": number|null,    "confidence": number|null, "evidence": string|null }
  }
}`;

const JUDGE_SYSTEM_PROMPT = `Eres un juez de calidad de datos de eventos musicales en Perú.

ENTRADA:
- Datos actuales del evento
- Contenido scrapeado de su página oficial
- (Opcional) external_music_context: señales de Spotify, MusicBrainz y Discogs sobre los artistas

TAREA: Emitir una decisión por cada campo listado al final, incluso si ya tiene valor.

ESTRUCTURA DE CADA DECISIÓN:
{
  "field": nombre del campo,
  "action": "ok" | "completar" | "corregir" | "dudoso",
  "current_value": valor actual en BD (puede ser null),
  "proposed_value": valor propuesto (null si action es "ok" o "dudoso"),
  "reason": explicación de la decisión,
  "evidence": texto literal extraído de la página (null si no hay),
  "confidence": número entre 0 y 1
}

DEFINICIÓN DE ACCIONES:
- ok        → campo correcto, sin cambio necesario
- completar → campo estaba null/vacío y encontraste el valor en la fuente
- corregir  → el campo tiene un valor realmente diferente y erróneo (proposed_value DEBE diferir de current_value)
- dudoso    → evidencia insuficiente o ambigua; el admin debe revisar

REGLAS POR CAMPO:

genres:
  - proposed_value debe ser un array de slugs exactos de available_genre_slugs del input.
    Mapeos obligatorios: "hard techno" → "techno" / "electronic" o "electrónica" → "electronica"
  - Nunca uses "electronica" por descarte, default o por palabras como fest, festival, party, noche, live.
  - Si el evento es "Vale Todo Downtown", nunca lo clasifiques como electrónica, house, techno, trance o edm. Debe priorizar géneros latinos/urbanos del catálogo, especialmente "reggaeton" y "urbano-latino".
  - Para festivales con nombre genérico: el género debe salir del lineup, la página oficial o external_music_context.
  - Para tributos/homenajes/aniversarios: usa el género real del artista homenajeado si hay evidencia. Si no, usa "dudoso".
  - Si no podés mapear a ningún slug del catálogo: usa "dudoso".

date / start_time:
  - Usa "corregir" solo si el instante UTC es realmente diferente. Diferencia de representación de timezone no es corrección.

venue:
  - Usa el nombre del recinto tal como aparece en la página. No agregues distrito ni ciudad si la fuente no los incluye.

price_min / price_max:
  - Solo usa "completar" si la ticketera o página muestra valores numéricos explícitos. No interpolés rangos.
  - Moneda: PEN salvo evidencia contraria.

General:
  - Si la página no es suficiente para un campo, podés usar external_music_context como evidencia secundaria.
  - Nunca inventes datos. Si ninguna fuente alcanza: "dudoso".
  - El input event.genres viene en texto legible (slugs/nombres), no como IDs numéricos. No interpretes códigos como géneros.

CAMPOS A REVISAR: name, lineup, genres, venue, date, start_time, price_min, price_max, description.

SALIDA: Solo JSON válido, sin markdown.
{"summary": string|null, "decisions": [{...}]}`;

export function getAiPromptCatalog(): AiPromptCatalog {
  return {
    enrichment_system_prompt: ENRICHMENT_SYSTEM_PROMPT,
    judge_system_prompt: JUDGE_SYSTEM_PROMPT,
  };
}

function normalizeJudgeProposal(payload: unknown): AiJudgeProposal {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rawDecisions = Array.isArray(root.decisions) ? root.decisions : [];

  const VALID_FIELDS = new Set<JudgeField>([
    "name", "lineup", "genres", "venue", "date", "start_time",
    "price_min", "price_max", "description", "visibility",
  ]);
  const VALID_ACTIONS = new Set<JudgeAction>(["ok", "completar", "corregir", "dudoso"]);

  const decisions: AiJudgeDecision[] = rawDecisions
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .filter((item) => VALID_FIELDS.has(item.field as JudgeField))
    .filter((item) => VALID_ACTIONS.has(item.action as JudgeAction))
    .map((item) => {
      let action = item.action as JudgeAction;
      const field = item.field as JudgeField;
      const current = item.current_value ?? null;
      const proposed = item.proposed_value ?? null;

      if (action === "corregir") {
        // Para fechas: comparar como instantes UTC, no como strings
        if (field === "date" && typeof current === "string" && typeof proposed === "string") {
          const tsA = Date.parse(current);
          const tsB = Date.parse(proposed);
          if (!isNaN(tsA) && !isNaN(tsB) && tsA === tsB) action = "ok";
        }
        // Para start_time: comparar solo HH:MM:SS ignorando timezone suffix
        else if (field === "start_time" && typeof current === "string" && typeof proposed === "string") {
          const normalize = (t: string) => t.slice(0, 8); // "21:00:00"
          if (normalize(current) === normalize(proposed)) action = "ok";
        }
        // Caso general: valores idénticos
        else if (JSON.stringify(current) === JSON.stringify(proposed)) {
          action = "ok";
        }
      }

      return {
        field,
        action,
        current_value: current,
        proposed_value: proposed,
        reason: typeof item.reason === "string" ? item.reason.trim() : "",
        evidence: cleanString(item.evidence),
        confidence: toConfidence(item.confidence),
      };
    })
    .filter((item) => item.reason.length > 0);

  return {
    summary: cleanString(root.summary),
    decisions,
  };
}

function collectNormalizedExternalSignals(contexts: ExternalArtistContext[]): string[] {
  return [...new Set(
    contexts
      .flatMap((context) => [
        ...context.spotify_genres,
        ...context.musicbrainz_tags,
        ...context.discogs_genres,
        ...context.discogs_styles,
      ])
      .map((value) => normalizeText(value))
      .filter(Boolean),
  )];
}

function containsAnyTerm(haystacks: string[], terms: string[]): boolean {
  return haystacks.some((haystack) => terms.some((term) => haystack.includes(normalizeText(term))));
}

function sanitizeGenreDecision(
  decision: AiJudgeDecision,
  row: EventCandidateRow,
  contexts: ExternalArtistContext[],
): AiJudgeDecision {
  if (decision.field !== "genres" || decision.action === "ok" || decision.action === "dudoso") {
    return decision;
  }

  const normalizedEventName = normalizeText(row.name ?? "");
  if (normalizedEventName.includes("vale todo downtown")) {
    return {
      ...decision,
      action: "completar",
      proposed_value: VALE_TODO_DOWNTOWN_GENRE_OVERRIDE,
      confidence: decision.confidence != null ? Math.max(decision.confidence, 0.95) : 0.95,
      reason: `Se forzó género latino/urbano para Vale Todo Downtown y se bloqueó la clasificación como electrónica. ${decision.reason}`,
      evidence: decision.evidence ?? row.name ?? null,
    };
  }

  const proposedSlugs = cleanStringArray(decision.proposed_value);
  if (!proposedSlugs.some((slug) => ELECTRONIC_GENRE_SLUGS.has(normalizeText(slug)))) {
    return decision;
  }

  const normalizedSignals = collectNormalizedExternalSignals(contexts);
  const normalizedEvidence = normalizeText(decision.evidence ?? "");
  const normalizedName = normalizeText(row.name ?? "");
  const normalizedDescription = normalizeText(row.description ?? "");
  const haystacks = [normalizedEvidence, normalizedName, normalizedDescription, ...normalizedSignals].filter(Boolean);

  const hasElectronicSupport = containsAnyTerm(haystacks, ELECTRONIC_SIGNAL_TERMS);
  const hasConflict = containsAnyTerm(haystacks, NON_ELECTRONIC_CONFLICT_TERMS);

  if (hasElectronicSupport && !hasConflict) {
    return decision;
  }

  return {
    ...decision,
    action: "dudoso",
    proposed_value: null,
    confidence: decision.confidence != null ? Math.min(decision.confidence, 0.45) : 0.45,
    reason: hasConflict
      ? `Se bloqueó la asignación automática de género electrónico porque contradice señales del artista o del evento. ${decision.reason}`
      : `Se bloqueó la asignación automática de género electrónico por falta de evidencia sólida. ${decision.reason}`,
  };
}

function shouldTryNextProvider(status: number | null, message: string): boolean {
  const normalized = message.toLowerCase();

  if (status === 429) return true;
  if (status != null && status >= 500) return true;
  if (status === 408) return true;
  if (status === 404 && /model_not_found|does not exist|do not have access/.test(normalized)) return true;
  if (status === 402 && /insufficient credits|credit|quota|billing/.test(normalized)) return true;
  if (status === 403 && /quota|billing|insufficient credits|rate limit|capacity|overloaded/.test(normalized)) return true;

  if (/429|rate limit|rate_limit_exceeded|tokens per minute|tokens per day|resource_exhausted/.test(normalized)) return true;
  if (/insufficient credits|credit balance|out of credits|payment required|billing/.test(normalized)) return true;
  if (/model_not_found|does not exist|do not have access/.test(normalized)) return true;
  if (/timeout|timed out|deadline exceeded|gateway timeout|request timeout|aborterror/.test(normalized)) return true;
  if (/econnreset|etimedout|enotfound|networkerror|fetch failed|temporarily unavailable|service unavailable|bad gateway|internal server error|overloaded|capacity/.test(normalized)) return true;
  if (/respuesta del proveedor de ia no contiene texto parseable|unexpected end of json input|json/.test(normalized)) return true;

  return false;
}

async function callWithFallback(
  messages: { role: string; content: string }[],
  parseResponse: (text: string) => AiJudgeProposal,
  errorPrefix: string,
): Promise<AiJudgeProposal> {
  const providers = [
    { url: resolveApiUrl(), key: resolveApiKey(), model: resolveModel(), provider: AI_ENRICHMENT_PROVIDER },
    ...(AI_FALLBACK_API_URL && AI_FALLBACK_API_KEY && AI_FALLBACK_MODEL
      ? [{ url: AI_FALLBACK_API_URL, key: AI_FALLBACK_API_KEY, model: AI_FALLBACK_MODEL, provider: AI_FALLBACK_PROVIDER }]
      : []),
    ...(AI_FALLBACK2_API_URL && AI_FALLBACK2_API_KEY && AI_FALLBACK2_MODEL
      ? [{ url: AI_FALLBACK2_API_URL, key: AI_FALLBACK2_API_KEY, model: AI_FALLBACK2_MODEL, provider: AI_FALLBACK2_PROVIDER }]
      : []),
  ];

  let lastError: Error | null = null;

  for (const p of providers) {
    try {
      const response = await fetch(p.url, {
        method: "POST",
        signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: p.model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const message = `${errorPrefix} ${response.status} [${p.provider}]: ${body.slice(0, 300)}`;
        if (shouldTryNextProvider(response.status, body)) {
          console.warn(`[ai-event-enrichment] ${p.provider} unavailable (${response.status}), trying fallback`);
          lastError = new Error(message);
          continue;
        }
        throw new Error(message);
      }

      const payload = await response.json();
      const jsonText = extractJsonText(payload);
      return parseResponse(jsonText);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (shouldTryNextProvider(null, lastError.message)) {
        console.warn(`[ai-event-enrichment] ${p.provider} transient/unavailable, trying fallback`);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error(`${errorPrefix}: all providers failed`);
}

async function callAiJudge(input: Record<string, unknown>): Promise<AiJudgeProposal> {
  ensureConfig();
  return callWithFallback(
    [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(input) },
    ],
    (text) => normalizeJudgeProposal(parseJsonObject(text)),
    "AI_JUDGE_ERROR",
  );
}

// Umbrales para autocorrección. Campos de solo lectura nunca pasan por aquí.
const JUDGE_CONFIDENCE_THRESHOLD = 0.85;
const JUDGE_PRICE_CONFIDENCE_THRESHOLD = 0.92;
const JUDGE_PRICE_COMPLETION_THRESHOLD = 0.82;
const JUDGE_VENUE_COMPLETION_THRESHOLD = 0.82;

function resolveAutoApply(
  decision: AiJudgeDecision,
  catalog: { genres: GenreCatalogEntry[]; synonyms: GenreSynonymEntry[] },
): { eventPatch: Record<string, unknown>; genreIds: number[] } | null {
  // Campos de solo lectura: nunca autocorregir
  if (!JUDGE_WRITABLE_FIELDS.has(decision.field)) return null;

  // "ok" o "dudoso": no hay nada que aplicar
  if (decision.action === "ok" || decision.action === "dudoso") return null;

  const conf = decision.confidence ?? 0;

  if (decision.field === "lineup") {
    const value = cleanStringArray(decision.proposed_value);
    if (!value.length || conf < JUDGE_CONFIDENCE_THRESHOLD) return null;
    return { eventPatch: { lineup: value }, genreIds: [] };
  }

  if (decision.field === "description") {
    const value = cleanString(decision.proposed_value);
    if (!value || value.length < 40 || conf < JUDGE_CONFIDENCE_THRESHOLD) return null;
    return { eventPatch: { description: value }, genreIds: [] };
  }

  if (decision.field === "venue") {
    const value = cleanString(decision.proposed_value);
    const threshold = decision.action === "completar" && decision.evidence
      ? JUDGE_VENUE_COMPLETION_THRESHOLD
      : JUDGE_CONFIDENCE_THRESHOLD;
    if (!value || conf < threshold) return null;
    return { eventPatch: { venue: value }, genreIds: [] };
  }

  if (decision.field === "genres") {
    const slugs = cleanStringArray(decision.proposed_value);
    const ids = mapGenres(slugs, catalog);
    // Si hay evidencia explícita ("completar"), umbral más bajo que al corregir
    const threshold = decision.action === "completar" && decision.evidence
      ? 0.70
      : JUDGE_CONFIDENCE_THRESHOLD;
    if (!ids.length || conf < threshold) return null;
    return { eventPatch: {}, genreIds: ids };
  }

  if (decision.field === "price_min") {
    const value = validatePrice(cleanNumber(decision.proposed_value));
    const threshold = decision.action === "completar" && decision.evidence
      ? JUDGE_PRICE_COMPLETION_THRESHOLD
      : JUDGE_PRICE_CONFIDENCE_THRESHOLD;
    if (value == null || conf < threshold) return null;
    return { eventPatch: { price_min: value }, genreIds: [] };
  }

  if (decision.field === "price_max") {
    const value = validatePrice(cleanNumber(decision.proposed_value));
    const threshold = decision.action === "completar" && decision.evidence
      ? JUDGE_PRICE_COMPLETION_THRESHOLD
      : JUDGE_PRICE_CONFIDENCE_THRESHOLD;
    if (value == null || conf < threshold) return null;
    return { eventPatch: { price_max: value }, genreIds: [] };
  }

  return null;
}

async function judgeSingleEvent(
  supabase: SupabaseClient,
  row: EventCandidateRow,
  catalog: { genres: GenreCatalogEntry[]; synonyms: GenreSynonymEntry[] },
  dryRun: boolean,
): Promise<JudgeBatchResult["results"][number]> {
  try {
    if (!row.ticket_url) {
      return { event_id: row.id, event_name: row.name, verdict: "failed", decisions: [], error: "no ticket_url" };
    }

    const markdown = await scrapeMarkdown(row.ticket_url, { waitFor: 1500 });
    const externalArtistContext = await gatherExternalArtistContext(row);
    const currentGenreTokens = genreTokensFromEventRow(row, catalog);
    const inputPayload = {
      event: {
        id: row.id,
        name: row.name,
        description: row.description,
        lineup: row.lineup ?? [],
        venue: row.venue,
        city: row.city,
        country_code: row.country_code,
        source: row.source,
        ticket_url: row.ticket_url,
        date: row.date,
        start_time: row.start_time,
        price_min: row.price_min,
        price_max: row.price_max,
        genres: currentGenreTokens,
      },
      available_genre_slugs: catalog.genres.map((g) => g.slug),
      page_markdown: slicePageMarkdown(markdown.markdown),
      external_music_context: externalArtistContext,
    };

    const proposal = await callAiJudge(inputPayload);
    proposal.decisions = proposal.decisions.map((decision) => {
      const normalizedDecision = decision.field === "genres"
        ? {
          ...decision,
          current_value: normalizeGenreDecisionValue(decision.current_value, catalog),
          proposed_value: normalizeGenreDecisionValue(decision.proposed_value, catalog),
        }
        : decision;
      return sanitizeGenreDecision(normalizedDecision, row, externalArtistContext);
    });
    const fallbackGenreDecision = buildExternalGenreDecision(row, externalArtistContext, catalog);
    if (fallbackGenreDecision && !proposal.decisions.some((decision) => decision.field === "genres" && decision.action !== "ok")) {
      proposal.decisions.push(fallbackGenreDecision);
    }

    const decisionResults: JudgeDecisionResult[] = [];
    const mergedEventPatch: Record<string, unknown> = {};
    const mergedGenreIds: number[] = [];

    for (const decision of proposal.decisions) {
      const patch = resolveAutoApply(decision, catalog);
      const autoApplied = patch !== null;

      decisionResults.push({
        field: decision.field,
        action: decision.action,
        current_value: decision.current_value,
        proposed_value: decision.proposed_value,
        reason: decision.reason,
        evidence: decision.evidence,
        confidence: decision.confidence,
        auto_applied: autoApplied,
      });

      if (patch && !dryRun) {
        Object.assign(mergedEventPatch, patch.eventPatch);
        mergedGenreIds.push(...patch.genreIds);
      }
    }

    const existingGenreIds = (row.event_genres ?? [])
      .map((item) => item.genre_id)
      .filter((item): item is string | number => item != null)
      .map((item) => Number(item));
    const finalGenreIds = [...new Set([...existingGenreIds, ...mergedGenreIds])];
    const finalGenreSlugs = catalog.genres
      .filter((genre) => finalGenreIds.includes(genre.id))
      .map((genre) => genre.slug);

    const nextName = typeof mergedEventPatch.name === "string"
      ? mergedEventPatch.name as string
      : row.name ?? "";

    const editorialReason = getEditorialExclusionReason({
      name: nextName,
      venue: typeof mergedEventPatch.venue === "string" ? mergedEventPatch.venue as string : row.venue,
      genreSlugs: finalGenreSlugs,
    });

    if (editorialReason) {
      decisionResults.push({
        field: "visibility",
        action: "corregir",
        current_value: row.is_active === false ? "hidden" : "visible",
        proposed_value: "hidden",
        reason: `El evento debe ocultarse de la app por regla editorial: ${editorialReason}.`,
        evidence: editorialReason,
        confidence: 1,
        auto_applied: !dryRun,
      });

      if (!dryRun) {
        mergedEventPatch.is_active = false;
      }
    }

    if (!dryRun) {
      if (Object.keys(mergedEventPatch).length > 0) {
        const { error } = await supabase.from("events").update(mergedEventPatch).eq("id", row.id);
        if (error) throw new Error(`JUDGE_PATCH failed for ${row.id}: ${error.message}`);
      }
      if (mergedGenreIds.length > 0) {
        const { error } = await supabase.from("event_genres").upsert(
          mergedGenreIds.map((genreId) => ({ event_id: row.id, genre_id: genreId })),
          { onConflict: "event_id,genre_id", ignoreDuplicates: true },
        );
        if (error) throw new Error(`JUDGE_GENRES_PATCH failed for ${row.id}: ${error.message}`);
      }
    }

    const hasCorrections = decisionResults.some((d) => d.action !== "ok");
    const hasPendingReview = decisionResults.some((d) =>
      (d.action === "dudoso") || (d.action !== "ok" && !d.auto_applied)
    );
    const verdict = !hasCorrections ? "valid" : hasPendingReview ? "needs_review" : "corrected";

    await writeEnrichmentLog(supabase, {
      event_id: row.id,
      status: verdict === "valid" ? "skipped" : decisionResults.some((d) => d.auto_applied) ? "applied" : "review",
      confidence: null,
      review_required: hasPendingReview,
      input_payload: inputPayload,
      proposed_patch: { summary: proposal.summary, decisions: proposal.decisions },
      applied_patch: { event_patch: mergedEventPatch, genre_ids: mergedGenreIds, applied_fields: decisionResults.filter((d) => d.auto_applied).map((d) => d.field) },
    });

    return { event_id: row.id, event_name: row.name, verdict, decisions: decisionResults };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected judge error";
    await writeEnrichmentLog(supabase, {
      event_id: row.id,
      status: "failed",
      review_required: false,
      input_payload: { event_id: row.id, ticket_url: row.ticket_url },
      error_message: message,
    });
    return { event_id: row.id, event_name: row.name, verdict: "failed", decisions: [], error: message };
  }
}

export async function validateEventsWithAiBatch(
  supabase: SupabaseClient,
  options: JudgeBatchInput = {},
): Promise<JudgeBatchResult> {
  ensureConfig();

  const dryRun = options.dry_run === true;
  const shouldSkipBlocked = options.force_refresh !== true && (options.event_ids?.length ?? 0) === 0;
  const skipResolved = options.force_refresh === true ? false : options.skip_resolved === true;
  const resolvedEventIds = skipResolved ? await fetchResolvedJudgeEventIds(supabase) : new Set<string>();
  const blockedEventIds = shouldSkipBlocked ? await fetchBlockedJudgeEventIds(supabase) : new Set<string>();
  const rows = await fetchEventCandidates(supabase, {
    ...options,
    only_incomplete: false,
    exclude_event_ids: [
      ...(options.exclude_event_ids ?? []),
      ...resolvedEventIds,
      ...blockedEventIds,
    ],
  });
  const catalog = await loadGenreCatalog(supabase);
  const results: JudgeBatchResult["results"] = [];

  for (const [index, row] of rows.entries()) {
    if (index > 0 && shouldThrottleBetweenEvents()) {
      await sleep(interEventDelayMs());
    }
    results.push(await judgeSingleEvent(supabase, row, catalog, dryRun));
  }

  return {
    count_selected: rows.length,
    count_processed: results.length,
    count_corrected: results.filter((r) => r.verdict === "corrected").length,
    count_valid: results.filter((r) => r.verdict === "valid").length,
    count_review: results.filter((r) => r.verdict === "needs_review").length,
    count_failed: results.filter((r) => r.verdict === "failed").length,
    dry_run: dryRun,
    results,
  };
}

function extractDecisions(value: unknown): AiAuditDecisionDto[] {
  if (!value || typeof value !== "object") return [];
  const decisions = (value as Record<string, unknown>).decisions;
  if (!Array.isArray(decisions)) return [];

  return decisions
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item) => ({
      field: typeof item.field === "string" ? item.field : "unknown",
      action: typeof item.action === "string" ? item.action : "unknown",
      current_value: item.current_value ?? null,
      proposed_value: item.proposed_value ?? null,
      reason: typeof item.reason === "string" ? item.reason : "",
      evidence: cleanString(item.evidence),
      confidence: toConfidence(item.confidence),
      auto_applied: item.auto_applied === true,
    }))
    .filter((item) => item.reason.length > 0 || item.action !== "unknown");
}

function isJudgeRunPatch(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const decisions = (value as Record<string, unknown>).decisions;
  return Array.isArray(decisions);
}

async function fetchResolvedJudgeEventIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .schema("normalization")
    .from("ai_event_enrichments")
    .select("event_id, status, review_required, created_at, proposed_patch")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(`AI_JUDGE_HISTORY_LOOKUP failed: ${error.message}`);
  }

  const resolved = new Set<string>();
  const seen = new Set<string>();
  for (const row of ((data ?? []) as JudgeRunRow[])) {
    if (!row.event_id || seen.has(row.event_id) || !isJudgeRunPatch(row.proposed_patch)) continue;
    seen.add(row.event_id);

    const finishedWithoutReview = row.review_required !== true &&
      (row.status === "applied" || row.status === "skipped");

    if (finishedWithoutReview) {
      resolved.add(row.event_id);
    }
  }

  return resolved;
}

async function fetchBlockedJudgeEventIds(
  supabase: SupabaseClient,
  lookbackHours = 24 * 7,
): Promise<Set<string>> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .schema("normalization")
    .from("ai_event_enrichments")
    .select("event_id, created_at, status, review_required")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(`AI_EVENT_ENRICHMENT_BLOCKED_LOOKUP failed: ${error.message}`);
  }

  const blocked = new Set<string>();
  const seen = new Set<string>();
  for (const row of ((data ?? []) as AiAttemptRow[])) {
    if (!row.event_id || seen.has(row.event_id)) continue;
    seen.add(row.event_id);

    const shouldBlock = row.status === "failed" || row.status === "pending" || row.status === "review" || row.review_required === true;
    if (shouldBlock) blocked.add(row.event_id);
  }

  return blocked;
}

function extractStringArrayField(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function extractSummary(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const summary = (value as Record<string, unknown>).summary;
  return cleanString(summary);
}

export async function getAiAuditOverview(
  supabase: SupabaseClient,
  limit = 20,
): Promise<AiAuditOverview> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const rawLimit = Math.max(safeLimit * 8, 200);
  const { data, error } = await supabase
    .schema("normalization")
    .from("ai_event_enrichments")
    .select("id, event_id, provider, model, status, confidence, review_required, created_at, finished_at, error_message, proposed_patch, applied_patch")
    .order("created_at", { ascending: false })
    .limit(rawLimit);

  if (error) throw new Error(`AI_AUDIT_LOOKUP failed: ${error.message}`);

  const latestRows = new Map<string, Record<string, unknown>>();
  const orphanRows: Array<Record<string, unknown>> = [];
  for (const row of ((data ?? []) as Array<Record<string, unknown>>)) {
    const eventId = typeof row.event_id === "string" ? row.event_id : null;
    if (!eventId) {
      orphanRows.push(row);
      continue;
    }
    if (!latestRows.has(eventId)) {
      latestRows.set(eventId, row);
    }
  }

  const rows = [...latestRows.values(), ...orphanRows].slice(0, safeLimit);
  const eventIds = [...new Set(rows
    .map((row) => typeof row.event_id === "string" ? row.event_id : null)
    .filter((id): id is string => Boolean(id)))];

  const eventNameMap = new Map<string, string | null>();
  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id, name")
      .in("id", eventIds);

    if (eventsError) throw new Error(`AI_AUDIT_EVENTS_LOOKUP failed: ${eventsError.message}`);
    for (const event of (events ?? []) as Array<{ id: string; name: string | null }>) {
      eventNameMap.set(event.id, event.name);
    }
  }

  const entries: AiAuditEntryDto[] = rows.map((row) => ({
    id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
    event_id: typeof row.event_id === "string" ? row.event_id : "",
    event_name: eventNameMap.get(typeof row.event_id === "string" ? row.event_id : "") ?? null,
    provider: typeof row.provider === "string" ? row.provider : "unknown",
    model: typeof row.model === "string" ? row.model : "unknown",
    status: (typeof row.status === "string" ? row.status : "failed") as AiAuditEntryDto["status"],
    confidence: toConfidence(row.confidence),
    review_required: row.review_required === true,
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    finished_at: typeof row.finished_at === "string" ? row.finished_at : null,
    error_message: cleanString(row.error_message),
    summary: extractSummary(row.proposed_patch),
    decisions: extractDecisions(row.proposed_patch),
    applied_fields: extractStringArrayField(row.applied_patch, "applied_fields"),
    proposed_fields: extractStringArrayField(row.applied_patch, "proposed_fields")
      .concat(extractStringArrayField(row.proposed_patch, "proposed_fields")),
  }));

  const effectiveStatus = (entry: AiAuditEntryDto): AiAuditEntryDto["status"] =>
    entry.review_required ? "review" : entry.status;

  return {
    total_recent_runs: entries.length,
    applied_recent_count: entries.filter((entry) => effectiveStatus(entry) === "applied").length,
    review_recent_count: entries.filter((entry) => effectiveStatus(entry) === "review").length,
    failed_recent_count: entries.filter((entry) => entry.status === "failed").length,
    entries,
  };
}

function normalizeTimeOnly(value: unknown): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  const match = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildApprovedFieldPatch(
  decision: AiAuditDecisionDto,
  catalog: { genres: GenreCatalogEntry[]; synonyms: GenreSynonymEntry[] },
): { eventPatch: Record<string, unknown>; genreIds: number[] } | null {
  if (decision.action !== "completar" && decision.action !== "corregir") return null;

  if (decision.field === "lineup") {
    const lineup = Array.isArray(decision.proposed_value)
      ? cleanStringArray(decision.proposed_value)
      : cleanStringArray(typeof decision.proposed_value === "string" ? [decision.proposed_value] : []);
    return lineup.length ? { eventPatch: { lineup }, genreIds: [] } : null;
  }

  if (decision.field === "description") {
    const description = cleanString(decision.proposed_value);
    return description ? { eventPatch: { description }, genreIds: [] } : null;
  }

  if (decision.field === "genres") {
    const genreTokens = Array.isArray(decision.proposed_value)
      ? cleanStringArray(decision.proposed_value)
      : cleanStringArray(typeof decision.proposed_value === "string" ? [decision.proposed_value] : []);
    const genreIds = mapGenres(genreTokens, catalog);
    return genreIds.length ? { eventPatch: {}, genreIds } : null;
  }

  if (decision.field === "price_min") {
    const price = validatePrice(cleanNumber(decision.proposed_value));
    return price != null ? { eventPatch: { price_min: price }, genreIds: [] } : null;
  }

  if (decision.field === "price_max") {
    const price = validatePrice(cleanNumber(decision.proposed_value));
    return price != null ? { eventPatch: { price_max: price }, genreIds: [] } : null;
  }

  if (decision.field === "name") {
    const name = cleanString(decision.proposed_value);
    return name ? { eventPatch: { name }, genreIds: [] } : null;
  }

  if (decision.field === "venue") {
    const venue = cleanString(decision.proposed_value);
    return venue ? { eventPatch: { venue }, genreIds: [] } : null;
  }

  if (decision.field === "date") {
    const date = cleanString(decision.proposed_value);
    return date ? { eventPatch: { date }, genreIds: [] } : null;
  }

  if (decision.field === "start_time") {
    const startTime = normalizeTimeOnly(decision.proposed_value);
    return startTime ? { eventPatch: { start_time: startTime }, genreIds: [] } : null;
  }

  if (decision.field === "visibility") {
    if (cleanString(decision.proposed_value) === "hidden") {
      return { eventPatch: { is_active: false }, genreIds: [] };
    }
  }

  return null;
}

export async function reviewAiAuditDecision(
  supabase: SupabaseClient,
  input: ReviewAiAuditDecisionInput,
): Promise<{ review_id: string; status: "applied" | "skipped" }> {
  const { data, error } = await supabase
    .schema("normalization")
    .from("ai_event_enrichments")
    .select("id, event_id, status, review_required, proposed_patch, applied_patch")
    .eq("id", input.review_id)
    .single();

  if (error || !data) throw new Error(`AI_REVIEW_LOOKUP failed: ${error?.message ?? "not found"}`);

  const row = data as Record<string, unknown>;
  const eventId = typeof row.event_id === "string" ? row.event_id : null;
  if (!eventId) throw new Error("AI review sin event_id");

  if (input.decision === "reject") {
    const now = new Date().toISOString();
    const { error: excludeEventError } = await supabase
      .from("events")
      .update({
        is_active: false,
        pipeline_excluded: true,
        pipeline_excluded_reason: "manual_ai_review_reject",
        pipeline_excluded_at: now,
      })
      .eq("id", eventId);
    if (excludeEventError) throw new Error(`AI_REVIEW_REJECT_EVENT failed: ${excludeEventError.message}`);

    const { error: updateError } = await supabase
      .schema("normalization")
      .from("ai_event_enrichments")
      .update({
        status: "skipped",
        review_required: false,
        updated_at: now,
      })
      .eq("id", input.review_id);
    if (updateError) throw new Error(`AI_REVIEW_REJECT failed: ${updateError.message}`);

    if (input.actor_user_id) {
      await supabase.schema("admin").from("audit_logs").insert({
        actor_user_id: input.actor_user_id,
        actor_role: input.actor_role ?? null,
        action: "ai_review.reject",
        entity_type: "ai_event_enrichment",
        entity_id: input.review_id,
        payload: {
          event_id: eventId,
          pipeline_excluded: true,
          pipeline_excluded_reason: "manual_ai_review_reject",
        },
      });
    }

    return { review_id: input.review_id, status: "skipped" };
  }

  const catalog = await loadGenreCatalog(supabase);
  const decisions = extractDecisions(row.proposed_patch);
  const eventPatch: Record<string, unknown> = {};
  const genreIds = new Set<number>();
  const overrideRows: Array<Record<string, unknown>> = [];

  for (const decision of decisions) {
    const patch = buildApprovedFieldPatch(decision, catalog);
    if (!patch) continue;
    Object.assign(eventPatch, patch.eventPatch);
    for (const genreId of patch.genreIds) genreIds.add(genreId);

    overrideRows.push({
      event_id: eventId,
      field_name: decision.field,
      previous_value: { value: decision.current_value },
      new_value: { value: decision.proposed_value, reason: decision.reason, evidence: decision.evidence },
      reason: `ai_review_approved:${decision.reason}`,
      created_by: input.actor_user_id ?? null,
      status: "applied",
    });
  }

  if (Object.keys(eventPatch).length > 0) {
    const { error: patchError } = await supabase
      .from("events")
      .update(eventPatch)
      .eq("id", eventId);
    if (patchError) throw new Error(`AI_REVIEW_APPLY_PATCH failed: ${patchError.message}`);
  }

  if (genreIds.size > 0) {
    const { error: genresError } = await supabase
      .from("event_genres")
      .upsert(
        [...genreIds].map((genreId) => ({ event_id: eventId, genre_id: genreId })),
        { onConflict: "event_id,genre_id", ignoreDuplicates: true },
      );
    if (genresError) throw new Error(`AI_REVIEW_APPLY_GENRES failed: ${genresError.message}`);
  }

  if (overrideRows.length > 0) {
    const { error: overridesError } = await supabase
      .schema("admin")
      .from("manual_event_overrides")
      .insert(overrideRows);
    if (overridesError) {
      console.error("[ai-event-enrichment] manual_event_overrides insert failed", overridesError);
    }
  }

  const { error: updateError } = await supabase
    .schema("normalization")
    .from("ai_event_enrichments")
    .update({
      status: "applied",
      review_required: false,
      applied_patch: {
        event_patch: eventPatch,
        genre_ids: [...genreIds],
        applied_fields: decisions
          .filter((decision) => buildApprovedFieldPatch(decision, catalog))
          .map((decision) => decision.field),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.review_id);
  if (updateError) throw new Error(`AI_REVIEW_MARK_APPLIED failed: ${updateError.message}`);

  if (input.actor_user_id) {
    await supabase.schema("admin").from("audit_logs").insert({
      actor_user_id: input.actor_user_id,
      actor_role: input.actor_role ?? null,
      action: "ai_review.approve",
      entity_type: "ai_event_enrichment",
      entity_id: input.review_id,
      payload: { event_id: eventId, event_patch: eventPatch, genre_ids: [...genreIds] },
    });
  }

  return { review_id: input.review_id, status: "applied" };
}
