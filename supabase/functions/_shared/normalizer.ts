export const MIN_VALID_PRICE_PEN = 30;

export type SourceId =
  | "ticketmaster"
  | "teleticket"
  | "joinnus"
  | "passline"
  | "vastion"
  | "tikpe";

export interface UnifiedEvent {
  source: SourceId;
  ticket_url: string;
  external_slug?: string;
  name: string;
  date: string | null;
  start_time?: string | null;
  venue?: string | null;
  city: string;
  country_code: string;
  cover_url?: string | null;
  price_min?: number | null;
  price_max?: number | null;
  lineup: string[];
  description?: string | null;
  genre_slugs: string[];
  is_active: boolean;
  scraper_version: string;
}

export interface EventRow {
  name: string;
  date: string | null;
  venue: string | null;
  venue_id: string | null;
  city: string;
  country_code: string;
  ticket_url: string;
  cover_url: string | null;
  price_min: number | null;
  price_max: number | null;
  start_time: string | null;
  lineup: string[];
  description: string | null;
  is_active: boolean;
  source: string;
  external_slug: string | null;
}

export function validatePrice(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value >= MIN_VALID_PRICE_PEN ? value : null;
}

export function extractMinPriceFromMarkdown(text: string): number | null {
  const re = /S\/\.?\s*(\d{1,6}(?:[.,]\d{1,2})?)/gi;
  const prices: number[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const value = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(value)) prices.push(value);
  }

  if (!prices.length) return null;
  return validatePrice(Math.min(...prices));
}

export function toEventRow(event: UnifiedEvent, venue_id: string | null): EventRow {
  return {
    name: event.name,
    date: event.date,
    venue: event.venue ?? null,
    venue_id,
    city: event.city,
    country_code: event.country_code,
    ticket_url: event.ticket_url,
    cover_url: event.cover_url ?? null,
    price_min: validatePrice(event.price_min),
    price_max: validatePrice(event.price_max),
    start_time: event.start_time ?? null,
    lineup: event.lineup,
    description: event.description ?? null,
    is_active: event.is_active,
    source: event.source,
    external_slug: event.external_slug ?? null,
  };
}

const SHORT_MONTH_MAP: Readonly<Record<string, number>> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
};

export function parseShortDate(raw: string): string | null {
  const s = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");

  const m = s.match(/^(\d{1,2})([a-z]{3,4})$/);
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const month = SHORT_MONTH_MAP[m[2].slice(0, 3)];
  if (!month || day < 1 || day > 31) return null;

  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (candidate < sixMonthsAgo) year++;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00-05:00`;
}

export function parseTicketmasterPeDateTime(
  raw: string,
): { date: string | null; start_time: string | null } {
  const s = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const dateM = s.match(/(\d{1,2})\s+de\s+([a-z]+)/);
  let date: string | null = null;

  if (dateM) {
    const day = parseInt(dateM[1], 10);
    const month = SHORT_MONTH_MAP[dateM[2].slice(0, 3)];

    if (month && day >= 1 && day <= 31) {
      const now = new Date();
      let year = now.getFullYear();
      const candidate = new Date(year, month - 1, day);
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      if (candidate < sixMonthsAgo) year++;
      date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00-05:00`;
    }
  }

  let start_time: string | null = null;
  const timeM = s.match(/(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/);
  if (timeM) {
    let h = parseInt(timeM[1], 10);
    const mi = timeM[2];
    const ap = timeM[3]?.replace(/\./g, "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    start_time = `${String(h).padStart(2, "0")}:${mi}:00`;
  }

  return { date, start_time };
}

export interface SyncResult {
  inserted: number;
  updated: number;
  failed: number;
  skipped: number;
}

export function emptySyncResult(): SyncResult {
  return { inserted: 0, updated: 0, failed: 0, skipped: 0 };
}

export function parseTikPeDate(raw: string): string | null {
  const s = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  const m = s.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/);
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const month = SHORT_MONTH_MAP[m[2].slice(0, 3)];
  const year = parseInt(m[3], 10);

  if (!month || day < 1 || day > 31 || year < 2020 || year > 2100) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00-05:00`;
}
