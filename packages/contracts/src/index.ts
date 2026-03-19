export type GenreDto = {
  id: number;
  slug: string;
  name: string;
};

export type EventGenreDto = {
  genres: GenreDto;
};

export type EventListItemDto = {
  id: string;
  name: string;
  date: string;
  start_time?: string | null;
  venue: string | null;
  city: string | null;
  country_code: string | null;
  ticket_url?: string | null;
  cover_url: string | null;
  price_min: number | null;
  price_max?: number | null;
  source?: string | null;
  availability_status?: string | null;
  is_active?: boolean;
  event_genres?: EventGenreDto[];
};

export type HomeFeedResponse = {
  featured: EventListItemDto[];
  listed: EventListItemDto[];
  genres: GenreDto[];
};

export type QualityIssueDto = {
  id: string;
  issue_type: string;
  issue_code: string;
  entity_type: string;
  entity_id: string;
  source: string | null;
  title: string;
  detail: Record<string, unknown>;
  status: "open" | "ignored" | "resolved";
  detected_at: string;
  resolved_at: string | null;
};

export type SyncRunItemDto = {
  id: string;
  sync_run_id: string;
  source: string;
  country_code: string;
  status: "success" | "failed";
  inserted_count: number;
  updated_count: number;
  failed_count: number;
  skipped_count: number;
  duration_ms: number;
  error_message: string | null;
};

export type SyncRunDto = {
  id: string;
  trigger_source: string;
  status: "running" | "success" | "failed" | "partial";
  started_at: string;
  finished_at: string | null;
  summary: Record<string, unknown>;
  items: SyncRunItemDto[];
};

export type AdminRole = "admin" | "operator" | "viewer";

export type AdminUserDto = {
  id: string;
  email: string | null;
  role: AdminRole;
  created_at: string | null;
  last_sign_in_at: string | null;
};

export type AuditLogDto = {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ManualEventOverrideDto = {
  id: string;
  event_id: string;
  field_name: string;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown>;
  reason: string | null;
  status: "applied" | "reverted";
  created_by: string | null;
  created_at: string;
};
