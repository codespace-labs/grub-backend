import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { scrapeMarkdown } from "../_shared/firecrawl.ts";
import { inferGenres, linkGenres } from "../_shared/genre-mapper.ts";
import { isMusicalEvent } from "../_shared/music-filter.ts";
import {
  emptySyncResult,
  toEventRow,
  parseTicketmasterPeDateTime,
  validatePrice,
  extractMinPriceFromMarkdown,
  type UnifiedEvent,
  type SyncResult,
} from "../_shared/normalizer.ts";
import { upsertEventCanonical } from "../_shared/event-write.ts";
import { upsertVenue } from "../_shared/venue-upsert.ts";
import {
  resolveEventLocation,
  stripTrailingCityFromEventName,
} from "../_shared/location-normalization.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const LISTING_URL = "https://www.ticketmaster.pe/page/categoria-conciertos";
const SOURCE = "ticketmaster" as const;
const SCRAPER_VERSION = "2026-03-19.1";
const DETAIL_BATCH_LIMIT = 25;
const DETAIL_THROTTLE_MS = 800;
const MIN_DATE = new Date("2026-01-01T00:00:00-05:00");

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ListingEvent {
  name: string;
  venue_raw: string | null;
  date_raw: string;
  cover_url: string | null;
  ticket_url: string;
  slug: string;
}

interface DetailContext {
  price_min: number | null;
  description: string | null;
  lineup: string[];
}

function normalizeBreaks(md: string): string {
  return md
    .replace(/\\\\\n/g, " ")
    .replace(/\\\s+/g, " ")
    .replace(/\s{2,}/g, " ");
}

function parseListingMarkdown(markdown: string): ListingEvent[] {
  const clean = normalizeBreaks(markdown);
  const chunks = clean.split(/(?=\[!\[)/);
  const events: ListingEvent[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    if (!chunk.includes("getcrowder.com")) continue;

    const imgM = chunk.match(/\[!\[([^\]]*)\]\((https:\/\/cdn\.getcrowder\.com\/[^)]+)\)/);
    if (!imgM) continue;

    const urlM = chunk.match(/\]\((https:\/\/www\.ticketmaster\.pe\/event\/([^)]+))\)\s*$/);
    if (!urlM) continue;

    const ticket_url = urlM[1];
    if (seen.has(ticket_url)) continue;
    seen.add(ticket_url);

    const venueM = chunk.match(/\*\*([^*]+)\*\*\s+(.+?)(?:\]\(https:\/\/www\.ticketmaster)/);
    const name = imgM[1].trim();
    const venue_raw = venueM?.[1]?.trim() ?? null;
    const date_raw = venueM?.[2]?.trim() ?? "";

    if (!name || !date_raw) continue;

    events.push({
      name,
      venue_raw,
      date_raw,
      cover_url: imgM[2],
      ticket_url,
      slug: urlM[2],
    });
  }

  return events;
}

function sanitizeMarkdownText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, " ")
    .replace(/[#>*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitArtists(value: string): string[] {
  return value
    .split(/\s*(?:,|\/|&|\+|\sy\s|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment.length <= 80);
}

function extractArtistsFromMarkdown(markdown: string): string[] {
  const patterns = [
    /\b(?:artista|artistas|lineup|invitados?)\b\s*[:\-]\s*([^\n]+)/gi,
    /\b(?:con|junto a)\b\s*[:\-]\s*([^\n]+)/gi,
  ];

  const matches: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(markdown)) !== null) {
      matches.push(...splitArtists(match[1] ?? ""));
    }
  }

  return [...new Set(matches)].slice(0, 6);
}

function extractDescriptionFromMarkdown(markdown: string): string | null {
  const sanitized = sanitizeMarkdownText(markdown);
  if (!sanitized) return null;
  return sanitized.slice(0, 1800);
}

async function fetchDetailContext(ticketUrl: string): Promise<DetailContext> {
  try {
    const { markdown } = await scrapeMarkdown(ticketUrl, { waitFor: 1500 }, 2);
    return {
      price_min: extractMinPriceFromMarkdown(markdown),
      description: extractDescriptionFromMarkdown(markdown),
      lineup: extractArtistsFromMarkdown(markdown),
    };
  } catch {
    return {
      price_min: null,
      description: null,
      lineup: [],
    };
  }
}

type UpsertOutcome = "inserted" | "updated" | "failed";

async function upsertEvent(event: UnifiedEvent): Promise<UpsertOutcome> {
  const loc = resolveEventLocation({ rawVenue: event.venue ?? null, rawName: event.name });

  const venue_id = loc.venue
    ? await upsertVenue(supabase, {
        name: loc.venue,
        city: loc.city,
        country_code: loc.country_code,
      })
    : null;

  const row = toEventRow(
    {
      ...event,
      name: stripTrailingCityFromEventName(event.name, loc.city),
      venue: loc.venue,
      city: loc.city,
      country_code: loc.country_code,
    },
    venue_id,
  );

  try {
    const upserted = await upsertEventCanonical(supabase, {
      ...row,
      availability: "available",
      availability_status: "available",
    });

    await linkGenres(supabase, upserted.eventId, event.genre_slugs);
    return upserted.operation;
  } catch (err) {
    console.error(`[sync-ticketmaster-pe] upsert error ${event.ticket_url}:`, err);
    return "failed";
  }
}

async function run(detailLimit = DETAIL_BATCH_LIMIT): Promise<SyncResult> {
  const result = emptySyncResult();
  console.log(`[sync-ticketmaster-pe] version=${SCRAPER_VERSION}`);

  const { markdown } = await scrapeMarkdown(LISTING_URL, { waitFor: 2000 });
  const listings = parseListingMarkdown(markdown);

  const todayLima = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
  todayLima.setHours(0, 0, 0, 0);

  const valid = listings.filter((e) => {
    if (!isMusicalEvent(e.name, e.venue_raw ?? "")) return false;
    const { date } = parseTicketmasterPeDateTime(e.date_raw);
    if (!date) return false;
    return new Date(date) >= MIN_DATE;
  });

  const futureListings = valid.filter((e) => {
    const { date } = parseTicketmasterPeDateTime(e.date_raw);
    return date ? new Date(date) >= todayLima : false;
  });

  console.log(`[sync-ticketmaster-pe] ${listings.length} total -> ${valid.length} validos (${futureListings.length} futuros)`);

  const toEnrich = futureListings.slice(0, detailLimit);
  const detailMap = new Map<string, DetailContext>();

  for (const e of toEnrich) {
    detailMap.set(e.ticket_url, await fetchDetailContext(e.ticket_url));
    await sleep(DETAIL_THROTTLE_MS);
  }

  for (const listing of valid) {
    const { date, start_time } = parseTicketmasterPeDateTime(listing.date_raw);
    if (!date) {
      result.skipped += 1;
      continue;
    }

    const detail = detailMap.get(listing.ticket_url);
    const event: UnifiedEvent = {
      source: SOURCE,
      ticket_url: listing.ticket_url,
      external_slug: listing.slug,
      name: listing.name,
      date,
      start_time,
      venue: listing.venue_raw,
      city: "Lima",
      country_code: "PE",
      cover_url: listing.cover_url,
      price_min: validatePrice(detail?.price_min ?? null),
      price_max: null,
      lineup: detail?.lineup ?? [],
      description: detail?.description ?? null,
      genre_slugs: inferGenres(listing.name, listing.venue_raw ?? ""),
      is_active: true,
      scraper_version: SCRAPER_VERSION,
    };

    const outcome = await upsertEvent(event);
    if (outcome === "failed") result.failed += 1;
    else result[outcome] += 1;
  }

  console.log(
    `[sync-ticketmaster-pe] done - inserted:${result.inserted} updated:${result.updated} failed:${result.failed} skipped:${result.skipped}`,
  );
  return result;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const detailLimit = typeof body.detailLimit === "number" ? body.detailLimit : DETAIL_BATCH_LIMIT;
    const result = await run(detailLimit);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[sync-ticketmaster-pe]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
