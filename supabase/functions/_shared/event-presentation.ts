export type EventCardImageFit = "cover" | "contain";

export type EventPresentation = {
  vertical_title?: string | null;
  horizontal_title?: string | null;
  category_badge?: string | null;
  vertical_image_fit?: EventCardImageFit | null;
  horizontal_image_fit?: EventCardImageFit | null;
};

const PRESENTATION_FIELD_MAP = {
  "presentation.vertical_title": "vertical_title",
  "presentation.horizontal_title": "horizontal_title",
  "presentation.category_badge": "category_badge",
  "presentation.vertical_image_fit": "vertical_image_fit",
  "presentation.horizontal_image_fit": "horizontal_image_fit",
} as const;

type PresentationFieldName = keyof typeof PRESENTATION_FIELD_MAP;
type PresentationProperty = (typeof PRESENTATION_FIELD_MAP)[PresentationFieldName];

export const PRESENTATION_OVERRIDE_FIELDS = Object.keys(
  PRESENTATION_FIELD_MAP,
) as PresentationFieldName[];

function normalizePresentationString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeImageFit(
  value: unknown,
): EventCardImageFit | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return value === "cover" || value === "contain" ? value : undefined;
}

export function normalizePresentationPayload(
  value: unknown,
): EventPresentation | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return {};

  const payload = value as Record<string, unknown>;

  const normalized: EventPresentation = {};

  const verticalTitle = normalizePresentationString(payload.vertical_title);
  if (verticalTitle !== undefined) normalized.vertical_title = verticalTitle;

  const horizontalTitle = normalizePresentationString(payload.horizontal_title);
  if (horizontalTitle !== undefined) normalized.horizontal_title = horizontalTitle;

  const categoryBadge = normalizePresentationString(payload.category_badge);
  if (categoryBadge !== undefined) normalized.category_badge = categoryBadge;

  const verticalImageFit = normalizeImageFit(payload.vertical_image_fit);
  if (verticalImageFit !== undefined) normalized.vertical_image_fit = verticalImageFit;

  const horizontalImageFit = normalizeImageFit(payload.horizontal_image_fit);
  if (horizontalImageFit !== undefined) normalized.horizontal_image_fit = horizontalImageFit;

  return normalized;
}

export function flattenPresentationOverrides(
  presentation: EventPresentation | undefined,
): Record<string, unknown> {
  if (!presentation) return {};

  const flatEntries = Object.entries(presentation)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [`presentation.${key}`, value]);

  return Object.fromEntries(flatEntries);
}

export function buildPresentationFromOverrides(
  rows: Array<{ field_name?: string | null; new_value?: Record<string, unknown> | null }>,
): EventPresentation | undefined {
  const presentation: EventPresentation = {};

  for (const row of rows) {
    const fieldName = row.field_name as PresentationFieldName | null | undefined;
    if (!fieldName || !(fieldName in PRESENTATION_FIELD_MAP)) continue;

    const property = PRESENTATION_FIELD_MAP[fieldName] as PresentationProperty;
    const rawValue = row.new_value?.[fieldName];

    if (rawValue === undefined) continue;
    (presentation as Record<string, unknown>)[property] = rawValue;
  }

  return Object.keys(presentation).length ? presentation : undefined;
}

type SupabaseSchemaClient = {
  schema: (name: string) => {
    from: (table: string) => {
      select: (query: string) => {
        in: (
          column: string,
          values: string[],
        ) => Promise<{
          data: Array<{
            event_id: string;
            field_name: string;
            new_value: Record<string, unknown>;
            created_at: string;
          }> | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

// Keep batches small enough to avoid oversized PostgREST query strings when
// event ids are expanded into an `in.(...)` filter.
const BATCH_SIZE = 20;

export async function attachPresentationToEvents<
  T extends { id: string; presentation?: EventPresentation | null },
>(
  supabase: SupabaseSchemaClient,
  events: T[],
): Promise<T[]> {
  if (!events.length) return events;

  const eventIds = events.map((event) => event.id);

  // Batch the query to avoid URL length limits with large event sets
  const rows: Array<{
    event_id: string;
    field_name: string;
    new_value: Record<string, unknown>;
    created_at: string;
  }> = [];

  for (let i = 0; i < eventIds.length; i += BATCH_SIZE) {
    const batch = eventIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .schema("admin")
      .from("manual_event_overrides")
      .select("event_id, field_name, new_value, created_at")
      .in("event_id", batch);

    if (error) throw error;
    if (data) rows.push(...data);
  }

  const data = rows;

  const latestByEventAndField = new Map<string, Map<string, { created_at: string; new_value: Record<string, unknown> }>>();

  for (const row of data ?? []) {
    if (!PRESENTATION_OVERRIDE_FIELDS.includes(row.field_name as PresentationFieldName)) {
      continue;
    }

    let fieldMap = latestByEventAndField.get(row.event_id);
    if (!fieldMap) {
      fieldMap = new Map();
      latestByEventAndField.set(row.event_id, fieldMap);
    }

    const previous = fieldMap.get(row.field_name);
    if (!previous || previous.created_at < row.created_at) {
      fieldMap.set(row.field_name, {
        created_at: row.created_at,
        new_value: row.new_value,
      });
    }
  }

  return events.map((event) => {
    const fieldMap = latestByEventAndField.get(event.id);
    if (!fieldMap) return event;

    const presentation = buildPresentationFromOverrides(
      Array.from(fieldMap.entries()).map(([field_name, value]) => ({
        field_name,
        new_value: value.new_value,
      })),
    );

    if (!presentation) return event;
    return {
      ...event,
      presentation,
    };
  });
}
