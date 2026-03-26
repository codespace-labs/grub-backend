import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { inferArtistsFromEventTitle } from "../_shared/music-normalization-service.ts";
import {
  attachPresentationToEvents,
  flattenPresentationOverrides,
  normalizePresentationPayload,
  type EventPresentation,
} from "../_shared/event-presentation.ts";

type EventPayload = {
  name?: string;
  date?: string;
  start_time?: string | null;
  venue?: string | null;
  city?: string | null;
  country_code?: string | null;
  ticket_url?: string | null;
  cover_url?: string | null;
  price_min?: number | null;
  price_max?: number | null;
  availability_status?: string | null;
  source?: string | null;
  is_active?: boolean;
  genre_ids?: number[] | null;
  presentation?: EventPresentation;
};

type BulkDeleteBody = {
  ids?: string[];
  source?: string;
  delete_sync_runs?: boolean;
};

type NormalizeMode = "create" | "update";
const EVENT_SELECT = `
  id, name, date, start_time, venue, city, country_code,
  ticket_url, cover_url, price_min, price_max,
  availability_status, source, is_active, created_at, updated_at,
  event_genres ( genres ( id, slug, name ) )
`;

function getEventIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const apiIndex = parts.findIndex((part) => part === "api-admin-events");
  if (apiIndex === -1) return null;
  return parts[apiIndex + 1] ?? null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSource(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeString(value);
  if (!normalized) return null;
  if (normalized === "ticketera-app") return "tikpe";
  return normalized;
}

function sourceAliases(source: string): string[] {
  if (source === "ticketmaster") return ["ticketmaster", "ticketmaster-pe"];
  if (source === "tikpe") return ["tikpe", "ticketera-app"];
  return [source];
}

function normalizeEventIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeEventPayload(
  payload: EventPayload,
  mode: NormalizeMode = "create",
): Record<string, unknown> {
  const date = payload.date !== undefined ? normalizeString(payload.date) : undefined;
  const startTime =
    payload.start_time !== undefined ? normalizeString(payload.start_time) : undefined;
  const normalizedDate =
    typeof date === "string" && !Number.isNaN(Date.parse(date))
      ? new Date(date).toISOString()
      : undefined;

  const normalized: Record<string, unknown> = {
    name:
      payload.name !== undefined
        ? normalizeString(payload.name)
        : undefined,
    date:
      payload.date !== undefined
        ? normalizedDate ?? null
        : undefined,
    start_time: startTime,
    venue:
      payload.venue !== undefined
        ? normalizeString(payload.venue)
        : undefined,
    city:
      payload.city !== undefined
        ? normalizeString(payload.city)
        : undefined,
    country_code:
      payload.country_code !== undefined
        ? normalizeString(payload.country_code)?.toUpperCase() ?? null
        : undefined,
    ticket_url:
      payload.ticket_url !== undefined
        ? normalizeString(payload.ticket_url)
        : undefined,
    cover_url:
      payload.cover_url !== undefined
        ? normalizeString(payload.cover_url)
        : undefined,
    price_min:
      payload.price_min !== undefined
        ? normalizeNumber(payload.price_min)
        : undefined,
    price_max:
      payload.price_max !== undefined
        ? normalizeNumber(payload.price_max)
        : undefined,
    availability_status:
      payload.availability_status !== undefined
        ? normalizeString(payload.availability_status)
        : mode === "create"
          ? "available"
          : undefined,
    source:
      payload.source !== undefined
        ? normalizeSource(payload.source)
        : mode === "create"
          ? "manual"
          : undefined,
    is_active:
      payload.is_active !== undefined
        ? Boolean(payload.is_active)
        : mode === "create"
          ? true
          : undefined,
  };

  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined)
  );
}

function normalizeGenreIds(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) return undefined;

  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  );
}

async function syncEventGenres(
  supabase: ReturnType<typeof createServiceClient>,
  eventId: string,
  genreIds: number[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("event_genres")
    .delete()
    .eq("event_id", eventId);

  if (deleteError) throw deleteError;

  if (!genreIds.length) return;

  const rows = genreIds.map((genreId) => ({
    event_id: eventId,
    genre_id: genreId,
  }));

  const { error: insertError } = await supabase.from("event_genres").insert(rows);
  if (insertError) throw insertError;
}

async function fetchEventWithGenres(
  supabase: ReturnType<typeof createServiceClient>,
  eventId: string,
) {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .single();

  if (error) throw error;
  const [eventWithPresentation] = await attachPresentationToEvents(supabase, [data]);
  return eventWithPresentation;
}

function slugifyArtistName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensurePrimaryArtistId(
  supabase: ReturnType<typeof createServiceClient>,
  eventId: string,
  eventName: string | null | undefined,
): Promise<string | null> {
  const { data: existingLinks, error: linksError } = await supabase
    .from("event_artists")
    .select("artist_id, order_index")
    .eq("event_id", eventId)
    .order("order_index", { ascending: true })
    .limit(1);

  if (linksError) throw linksError;

  const linkedArtistId = existingLinks?.[0]?.artist_id ?? null;
  if (linkedArtistId) return linkedArtistId;

  const inferredArtists = inferArtistsFromEventTitle(eventName);
  if (inferredArtists.length !== 1) return null;

  const inferredName = inferredArtists[0]?.trim() ?? "";
  const inferredSlug = slugifyArtistName(inferredName);
  if (!inferredSlug) return null;

  const { data: existingArtist, error: artistLookupError } = await supabase
    .from("artists")
    .select("id")
    .eq("slug", inferredSlug)
    .maybeSingle();

  if (artistLookupError) throw artistLookupError;

  let artistId = existingArtist?.id ?? null;

  if (!artistId) {
    const { data: createdArtist, error: createArtistError } = await supabase
      .from("artists")
      .insert({
        name: inferredName,
        slug: inferredSlug,
      })
      .select("id")
      .single();

    if (createArtistError) throw createArtistError;
    artistId = createdArtist.id;
  }

  const { error: linkError } = await supabase
    .from("event_artists")
    .insert({
      event_id: eventId,
      artist_id: artistId,
      order_index: 0,
    });

  if (linkError) {
    const message = String(linkError.message ?? "");
    if (!message.toLowerCase().includes("duplicate")) {
      throw linkError;
    }
  }

  return artistId;
}

async function mergeArtistGenres(
  supabase: ReturnType<typeof createServiceClient>,
  artistId: string,
  genreIds: number[],
): Promise<void> {
  if (!genreIds.length) return;

  const { data: existingRows, error: existingError } = await supabase
    .from("artist_genres")
    .select("genre_id")
    .eq("artist_id", artistId)
    .in("genre_id", genreIds);

  if (existingError) throw existingError;

  const existingGenreIds = new Set(
    (existingRows ?? [])
      .map((row) => row.genre_id)
      .filter((value): value is number => typeof value === "number"),
  );

  const rowsToInsert = genreIds
    .filter((genreId) => !existingGenreIds.has(genreId))
    .map((genreId) => ({
      artist_id: artistId,
      genre_id: genreId,
    }));

  if (!rowsToInsert.length) return;

  const { error: insertError } = await supabase
    .from("artist_genres")
    .insert(rowsToInsert);

  if (insertError) throw insertError;
}

async function propagateEventGenresToPrimaryArtist(
  supabase: ReturnType<typeof createServiceClient>,
  eventId: string,
  eventName: string | null | undefined,
  genreIds: number[],
): Promise<string | null> {
  if (!genreIds.length) return null;

  const artistId = await ensurePrimaryArtistId(supabase, eventId, eventName);
  if (!artistId) return null;

  await mergeArtistGenres(supabase, artistId, genreIds);
  return artistId;
}

async function insertAuditLog(
  supabase: ReturnType<typeof createServiceClient>,
  payload: {
    actor_user_id: string;
    actor_role: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.schema("admin").from("audit_logs").insert(payload);
  if (error) {
    console.error("[api-admin-events] audit_logs insert failed", error);
  }
}

async function insertManualOverrides(
  supabase: ReturnType<typeof createServiceClient>,
  eventId: string,
  userId: string,
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Promise<void> {
  const rows = Object.entries(next).map(([fieldName, newValue]) => ({
    event_id: eventId,
    field_name: fieldName,
    previous_value: { [fieldName]: current[fieldName] ?? null },
    new_value: { [fieldName]: newValue },
    reason: "backoffice_edit",
    created_by: userId,
  }));

  if (!rows.length) return;

  const { error } = await supabase.schema("admin").from("manual_event_overrides").insert(rows);
  if (error) {
    console.error("[api-admin-events] manual_event_overrides insert failed", error);
  }
}

function normalizeComparableValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) {
      return new Date(parsedDate).toISOString();
    }
    return trimmed;
  }
  return value ?? null;
}

function pickChangedFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => {
      const currentValue = normalizeComparableValue(current[key]);
      const nextValue = normalizeComparableValue(value);
      return JSON.stringify(currentValue) !== JSON.stringify(nextValue);
    }),
  );
}

async function deleteEventsBulk(
  supabase: ReturnType<typeof createServiceClient>,
  user: { id: string },
  role: string,
  body: BulkDeleteBody,
) {
  const ids = normalizeEventIds(body.ids);
  const source = normalizeSource(body.source);
  const deleteSyncRuns = body.delete_sync_runs !== false;

  if (!ids.length && !source) {
    return jsonResponse({ error: "Missing ids or source" }, 400);
  }

  let eventQuery = supabase
    .from("events")
    .select("id, name, source");

  if (ids.length) eventQuery = eventQuery.in("id", ids);
  if (source) eventQuery = eventQuery.eq("source", source);

  const { data: existingEvents, error: existingEventsError } = await eventQuery;
  if (existingEventsError) throw existingEventsError;

  const eventIds = (existingEvents ?? []).map((event) => event.id);
  if (eventIds.length) {
    const { error: deleteEventsError } = await supabase
      .from("events")
      .delete()
      .in("id", eventIds);

    if (deleteEventsError) throw deleteEventsError;
  }

  let deletedRunCount = 0;
  if (source && deleteSyncRuns) {
    const aliases = sourceAliases(source);
    const { data: runs, error: runsError } = await supabase
      .schema("ingestion")
      .from("sync_runs")
      .select("id")
      .overlaps("source_filters", aliases);

    if (runsError) throw runsError;

    const runIds = (runs ?? []).map((run) => run.id);
    deletedRunCount = runIds.length;

    if (runIds.length) {
      const { error: deleteRunsError } = await supabase
        .schema("ingestion")
        .from("sync_runs")
        .delete()
        .in("id", runIds);

      if (deleteRunsError) throw deleteRunsError;
    }
  }

  await insertAuditLog(supabase, {
    actor_user_id: user.id,
    actor_role: role,
    action: source ? "events.bulk_delete_source" : "events.bulk_delete",
    entity_type: source ? "source" : "event",
    entity_id: source ?? null,
    payload: {
      source: source ?? null,
      ids: ids.length ? ids : null,
      deleted_event_count: eventIds.length,
      deleted_sync_run_count: deletedRunCount,
      deleted_event_ids: eventIds,
    },
  });

  return jsonResponse({
    ok: true,
    deleted_event_count: eventIds.length,
    deleted_sync_run_count: deletedRunCount,
    source: source ?? null,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const eventId = getEventIdFromPath(url.pathname);

    if (req.method === "GET") {
      await requireAdmin(req, "viewer");

      const source = url.searchParams.get("source");
      const status = url.searchParams.get("status");
      const sort   = url.searchParams.get("sort"); // "recent" → order by updated_at DESC
      const limit  = Number(url.searchParams.get("limit") ?? "500");
      const offset = Number(url.searchParams.get("offset") ?? "0");

      const supabase = createServiceClient();
      let query = supabase
        .from("events")
        .select(EVENT_SELECT)
        .order(sort === "recent" ? "updated_at" : "date", { ascending: sort !== "recent" })
        .range(offset, offset + limit - 1);

      if (source) query = query.eq("source", source);
      if (status === "active") query = query.eq("is_active", true);
      if (status === "inactive") query = query.eq("is_active", false);

      const { data, error } = await query;
      if (error) throw error;
      const events = await attachPresentationToEvents(supabase, data ?? []);

      return jsonResponse({ events, total: events.length });
    }

    const minRole = req.method === "DELETE" ? "admin" : "operator";
    const { user, role } = await requireAdmin(req, minRole);
    const supabase = createServiceClient();

    if (req.method === "DELETE" && !eventId) {
      const body = (await req.json().catch(() => ({}))) as BulkDeleteBody;
      return await deleteEventsBulk(supabase, user, role, body);
    }

    if (req.method === "POST") {
      const rawPayload = (await req.json().catch(() => ({}))) as EventPayload;
      const payload = normalizeEventPayload(
        rawPayload,
        "create",
      );
      const genreIds = normalizeGenreIds(rawPayload.genre_ids) ?? [];
      const presentation = normalizePresentationPayload(rawPayload.presentation);
      if (!payload.name || !payload.date) {
        return jsonResponse({ error: "Missing required fields" }, 400);
      }

      const { data, error } = await supabase
        .from("events")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw error;

      await syncEventGenres(supabase, data.id, genreIds);
      if (presentation && Object.keys(presentation).length) {
        await insertManualOverrides(
          supabase,
          data.id,
          user.id,
          {},
          flattenPresentationOverrides(presentation),
        );
      }
      const fullEvent = await fetchEventWithGenres(supabase, data.id);
      const propagatedArtistId = await propagateEventGenresToPrimaryArtist(
        supabase,
        data.id,
        fullEvent.name,
        genreIds,
      );

      await insertAuditLog(supabase, {
        actor_user_id: user.id,
        actor_role: role,
        action: "event.create",
        entity_type: "event",
        entity_id: fullEvent.id,
        payload: {
          ...payload,
          genre_ids: genreIds,
          presentation,
          propagated_artist_id: propagatedArtistId,
        },
      });

      return jsonResponse({ event: fullEvent }, 201);
    }

    if (!eventId) {
      return jsonResponse({ error: "Missing event id" }, 400);
    }

    const { data: current, error: currentError } = await supabase
      .from("events")
      .select(`
        id, name, date, start_time, venue, city, country_code,
        ticket_url, cover_url, price_min, price_max,
        availability_status, source, is_active,
        event_genres ( genres ( id, slug, name ) )
      `)
      .eq("id", eventId)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) return jsonResponse({ error: "Not found" }, 404);

    if (req.method === "PATCH") {
      const rawPayload = (await req.json().catch(() => ({}))) as EventPayload;
      const payload = normalizeEventPayload(
        rawPayload,
        "update",
      );
      const genreIds = normalizeGenreIds(rawPayload.genre_ids);
      const presentation = normalizePresentationPayload(rawPayload.presentation);
      const presentationOverrides = flattenPresentationOverrides(presentation);
      if (!Object.keys(payload).length && genreIds === undefined) {
        if (!Object.keys(presentationOverrides).length) {
          return jsonResponse({ error: "Empty payload" }, 400);
        }
      }

      const changedPayload = pickChangedFields(
        current as Record<string, unknown>,
        payload,
      );
      const currentGenreIds = (current.event_genres ?? [])
        .map((item: { genres?: { id?: number | null } | null }) => item.genres?.id)
        .filter((value: number | null | undefined): value is number => typeof value === "number")
        .sort();
      const nextGenreIds = genreIds ? [...genreIds].sort() : undefined;
      const genresChanged =
        nextGenreIds !== undefined &&
        JSON.stringify(currentGenreIds) !== JSON.stringify(nextGenreIds);
      const changedPresentation = pickChangedFields(
        (current.presentation ?? {}) as Record<string, unknown>,
        presentation ?? {},
      );
      const changedPresentationOverrides = flattenPresentationOverrides(
        changedPresentation as EventPresentation,
      );

      if (!Object.keys(changedPayload).length && !genresChanged && !Object.keys(changedPresentationOverrides).length) {
        return jsonResponse({ event: current });
      }

      if (Object.keys(changedPayload).length) {
        const { error } = await supabase
          .from("events")
          .update(changedPayload)
          .eq("id", eventId);

        if (error) throw error;
      }

      if (genresChanged) {
        await syncEventGenres(supabase, eventId, nextGenreIds ?? []);
      }

      const data = await fetchEventWithGenres(supabase, eventId);
      const propagatedArtistId =
        genresChanged && nextGenreIds
          ? await propagateEventGenresToPrimaryArtist(
              supabase,
              eventId,
              data.name,
              nextGenreIds,
            )
          : null;

      await insertManualOverrides(
        supabase,
        eventId,
        user.id,
        current as Record<string, unknown>,
        {
          ...changedPayload,
          ...(genresChanged ? { genre_ids: nextGenreIds ?? [] } : {}),
          ...changedPresentationOverrides,
          ...(propagatedArtistId ? { propagated_artist_id: propagatedArtistId } : {}),
        },
      );

      await insertAuditLog(supabase, {
        actor_user_id: user.id,
        actor_role: role,
        action: "event.update",
        entity_type: "event",
        entity_id: eventId,
        payload: {
          previous: current,
          next: {
            ...changedPayload,
            ...(genresChanged ? { genre_ids: nextGenreIds ?? [] } : {}),
            ...(Object.keys(changedPresentation).length ? { presentation: changedPresentation } : {}),
            ...(propagatedArtistId ? { propagated_artist_id: propagatedArtistId } : {}),
          },
        },
      });

      return jsonResponse({ event: data });
    }

    const { error } = await supabase.from("events").delete().eq("id", eventId);
    if (error) throw error;

    await insertAuditLog(supabase, {
      actor_user_id: user.id,
      actor_role: role,
      action: "event.delete",
      entity_type: "event",
      entity_id: eventId,
      payload: { previous: current },
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("[api-admin-events]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
