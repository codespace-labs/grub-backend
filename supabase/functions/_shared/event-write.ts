import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface LegacyEventWriteRow {
  name: string;
  date: string | null;
  starts_at?: string | null;
  venue: string | null;
  venue_id: string | null;
  city: string;
  country_code: string;
  ticket_url: string;
  cover_url: string | null;
  price_min: number | null;
  price_max: number | null;
  start_time?: string | null;
  lineup: string[];
  description: string | null;
  is_active: boolean;
  source: string;
  external_slug?: string | null;
  availability?: string | null;
  availability_status?: string | null;
}

export interface EventWriteResult {
  eventId: string;
  operation: "inserted" | "updated";
}

function computeStartsAt(row: LegacyEventWriteRow): string | null {
  if (row.starts_at) return row.starts_at;
  if (!row.date) return null;
  if (!row.start_time) return row.date;

  const dateOnly = row.date.slice(0, 10);
  const timeOnly = row.start_time.slice(0, 8);
  return `${dateOnly}T${timeOnly}-05:00`;
}

async function findExistingEventId(
  supabase: SupabaseClient,
  row: LegacyEventWriteRow,
): Promise<string | null> {
  if (row.external_slug) {
    const { data } = await supabase
      .from("event_sources")
      .select("event_id")
      .eq("source", row.source)
      .eq("external_slug", row.external_slug)
      .eq("country_code", row.country_code)
      .limit(1)
      .maybeSingle();

    if (data?.event_id) return data.event_id as string;
  }

  if (row.ticket_url) {
    const { data } = await supabase
      .from("event_sources")
      .select("event_id")
      .eq("source", row.source)
      .eq("ticket_url", row.ticket_url)
      .limit(1)
      .maybeSingle();

    if (data?.event_id) return data.event_id as string;
  }

  if (row.external_slug) {
    const { data } = await supabase
      .from("events")
      .select("id")
      .eq("source", row.source)
      .eq("external_slug", row.external_slug)
      .limit(1)
      .maybeSingle();

    if (data?.id) return data.id as string;
  }

  const { data } = await supabase
    .from("events")
    .select("id")
    .eq("ticket_url", row.ticket_url)
    .limit(1)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

export async function upsertEventCanonical(
  supabase: SupabaseClient,
  row: LegacyEventWriteRow,
): Promise<EventWriteResult> {
  const existingEventId = await findExistingEventId(supabase, row);

  let existing: {
    id: string;
    price_min: number | null;
    price_max: number | null;
    start_time: string | null;
    venue_id: string | null;
    is_active: boolean;
  } | null = null;

  if (existingEventId) {
    const { data, error } = await supabase
      .from("events")
      .select("id, price_min, price_max, start_time, venue_id, is_active")
      .eq("id", existingEventId)
      .single();

    if (error) throw new Error(`EVENT_LOOKUP failed for ${existingEventId}: ${error.message}`);
    existing = data;
  }

  const startsAt = computeStartsAt(row);
  const writeRow = existing
    ? {
        ...row,
        starts_at: startsAt,
        external_slug: row.external_slug ?? null,
        availability: row.availability ?? "available",
        availability_status: row.availability_status ?? "available",
        price_min: row.price_min ?? existing.price_min,
        price_max: row.price_max ?? existing.price_max,
        start_time: row.start_time ?? existing.start_time,
        venue_id: row.venue_id ?? existing.venue_id,
        is_active: existing.is_active,
      }
    : {
        ...row,
        starts_at: startsAt,
        external_slug: row.external_slug ?? null,
        availability: row.availability ?? "available",
        availability_status: row.availability_status ?? "available",
      };

  const { data: persisted, error: persistError } = existing
    ? await supabase
        .from("events")
        .update(writeRow)
        .eq("id", existing.id)
        .select("id")
        .single()
    : await supabase
        .from("events")
        .insert(writeRow)
        .select("id")
        .single();

  if (persistError || !persisted) {
    throw new Error(`EVENT_UPSERT failed for ${row.ticket_url}: ${persistError?.message}`);
  }

  const eventId = persisted.id as string;

  const { data: existingOccurrence, error: occurrenceLookupError } = await supabase
    .from("event_occurrences")
    .select("id")
    .eq("event_id", eventId)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();

  if (occurrenceLookupError) {
    throw new Error(`OCCURRENCE_LOOKUP failed for ${eventId}: ${occurrenceLookupError.message}`);
  }

  if (startsAt) {
    const occurrenceRow = {
      event_id: eventId,
      source: row.source,
      starts_at: startsAt,
      local_date: startsAt.slice(0, 10),
      start_time: row.start_time ?? null,
      timezone: "America/Lima",
      venue_id: row.venue_id,
      venue_name: row.venue,
      city: row.city,
      country_code: row.country_code,
      status: row.availability === "cancelled" ? "cancelled" : "scheduled",
      is_primary: true,
      legacy_event_date: row.date,
      updated_at: new Date().toISOString(),
    };

    const occurrenceResult = existingOccurrence?.id
      ? await supabase
          .from("event_occurrences")
          .update(occurrenceRow)
          .eq("id", existingOccurrence.id)
      : await supabase
          .from("event_occurrences")
          .insert(occurrenceRow);

    if (occurrenceResult.error) {
      throw new Error(`OCCURRENCE_UPSERT failed for ${eventId}: ${occurrenceResult.error.message}`);
    }
  }

  const { data: existingSource, error: sourceLookupError } = await supabase
    .from("event_sources")
    .select("id")
    .eq("event_id", eventId)
    .eq("source", row.source)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();

  if (sourceLookupError) {
    throw new Error(`SOURCE_LOOKUP failed for ${eventId}: ${sourceLookupError.message}`);
  }

  const sourceRow = {
    event_id: eventId,
    source: row.source,
    country_code: row.country_code,
    source_event_key: row.external_slug ?? row.ticket_url,
    external_slug: row.external_slug ?? null,
    ticket_url: row.ticket_url,
    observed_availability_status: row.availability_status ?? "available",
    price_min: row.price_min,
    price_max: row.price_max,
    cover_url: row.cover_url,
    raw_payload: {
      legacy_event_id: eventId,
      source: row.source,
      ticket_url: row.ticket_url,
      external_slug: row.external_slug ?? null,
    },
    payload_checksum: [
      row.source,
      row.country_code,
      row.ticket_url,
      row.external_slug ?? "",
      row.price_min ?? "",
      row.price_max ?? "",
      row.cover_url ?? "",
      row.availability_status ?? "",
    ].join("|"),
    is_primary: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const sourceResult = existingSource?.id
    ? await supabase
        .from("event_sources")
        .update(sourceRow)
        .eq("id", existingSource.id)
    : await supabase
        .from("event_sources")
        .insert({
          ...sourceRow,
          first_seen_at: new Date().toISOString(),
        });

  if (sourceResult.error) {
    throw new Error(`SOURCE_UPSERT failed for ${eventId}: ${sourceResult.error.message}`);
  }

  if (row.cover_url) {
    const { error: assetError } = await supabase
      .from("event_assets")
      .upsert({
        event_id: eventId,
        source: row.source,
        asset_kind: "cover",
        url: row.cover_url,
        origin: "scraper",
        sort_order: 0,
        is_primary: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "event_id,asset_kind,url" });

    if (assetError) {
      throw new Error(`ASSET_UPSERT failed for ${eventId}: ${assetError.message}`);
    }
  }

  return {
    eventId,
    operation: existing ? "updated" : "inserted",
  };
}
