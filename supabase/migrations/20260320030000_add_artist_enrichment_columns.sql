-- ─────────────────────────────────────────────────────────────────────────────
-- Artist enrichment columns (no-destructiva)
--
-- Agrega columnas de enriquecimiento a la tabla artists existente.
-- Idempotente: puede correrse más de una vez sin efecto.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.artists
  add column if not exists photo_url            text          null,
  add column if not exists photo_source         text          null,
  add column if not exists canonical_genre_ids  uuid[]        null,
  add column if not exists enriched_at          timestamptz   null,
  add column if not exists enrichment_failed    boolean       not null default false;

-- Índice para que el enricher solo consulte artistas pendientes
create index if not exists artists_enrichment_pending_idx
  on public.artists (enrichment_failed, enriched_at)
  where enriched_at is null and enrichment_failed = false;

comment on column public.artists.photo_url           is 'URL de la foto del artista (wikimedia o lastfm)';
comment on column public.artists.photo_source        is 'Origen de la foto: "wikimedia" | "lastfm"';
comment on column public.artists.canonical_genre_ids is 'IDs canónicos de géneros vinculados (desnormalizado para consultas rápidas)';
comment on column public.artists.enriched_at         is 'Timestamp del último enriquecimiento exitoso';
comment on column public.artists.enrichment_failed   is 'True si todos los intentos de enriquecimiento fallaron — no se reintenta';
