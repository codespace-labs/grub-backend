-- ─────────────────────────────────────────────────────────────────────────────
-- Canonical genres layer (no-destructive)
--
-- Agrega canonical_slug a la tabla genres existente y mapea los géneros raw
-- actuales a sus canónicos. Los géneros sin mapeo quedan con canonical_slug NULL.
--
-- Idempotente: puede correrse más de una vez sin efecto.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Agregar columna (idempotente) ─────────────────────────────────────────
alter table public.genres
  add column if not exists canonical_slug text null;

-- ── 2. Índice para queries del onboarding ────────────────────────────────────
create index if not exists genres_canonical_slug_idx
  on public.genres (canonical_slug)
  where canonical_slug is not null;

-- ── 3. Función de normalización (lowercase + trim + unaccent) ────────────────
--      Reutilizada por el UPDATE masivo y por la vista.
create extension if not exists unaccent;

create or replace function public._normalize_genre(raw text)
returns text
language sql
immutable
as $$
  select lower(trim(unaccent(coalesce(raw, ''))))
$$;

-- ── 4. UPDATE masivo de canonical_slug ───────────────────────────────────────
--      Normaliza cada slug existente y lo mapea a su canónico.
--      Los géneros sin mapeo quedan con canonical_slug = NULL.
--      Usamos DO $$ para poder declarar variables de normalización.

do $$
declare
  r record;
  norm text;
  canon text;
begin
  for r in select id, slug from public.genres loop

    norm  := public._normalize_genre(r.slug);
    canon := null;

    -- ── Electrónica ──────────────────────────────────────────────────────────
    if norm ~ '(electro|edm|techno|house|eurodance|ebm|electronic body|trance|ambient|minimal|dnb|drum.?n.?bass|breakbeat|rave)' then
      canon := 'electronica';
    end if;

    -- ── Rock ─────────────────────────────────────────────────────────────────
    if norm ~ '^rock$|^rock ' or norm ~ ' rock$' then
      canon := 'rock';
    end if;

    -- ── Metal ────────────────────────────────────────────────────────────────
    if norm ~ 'metal|heavy' then
      canon := 'metal';
    end if;

    -- ── Punk ─────────────────────────────────────────────────────────────────
    if norm ~ '^punk$|punk rock|hardcore' then
      canon := 'punk';
    end if;

    -- ── Indie / Alternativo ───────────────────────────────────────────────────
    if norm ~ '^indie$|indie pop|indie rock' then
      canon := 'indie';
    end if;
    if norm ~ 'alternati|folk|blues' then
      canon := 'alternativo';
    end if;

    -- ── Pop ──────────────────────────────────────────────────────────────────
    if norm ~ '^pop$|pop latino|latin pop|k.?pop' then
      canon := 'pop';
    end if;

    -- ── Hip-Hop / Rap ─────────────────────────────────────────────────────────
    if norm ~ 'hip.?hop|^rap$' then
      canon := 'hip-hop';
    end if;

    -- ── Urbano (trap + urban latin) ───────────────────────────────────────────
    if norm ~ '^trap$|trap latino|urbano|urban latin|freestyle' then
      canon := 'urbano';
    end if;

    -- ── Reggaetón ────────────────────────────────────────────────────────────
    if norm ~ 'reggaet|perreo|dembow' then
      canon := 'reggaeton';
    end if;

    -- ── R&B ──────────────────────────────────────────────────────────────────
    if norm ~ 'r.?&.?b|rnb|r.n.b|soul|neo.?soul|funk' then
      canon := 'rnb';
    end if;

    -- ── Jazz ─────────────────────────────────────────────────────────────────
    if norm ~ '^jazz$|jazz fusion|jazz latino' then
      canon := 'jazz';
    end if;

    -- ── Clásica ───────────────────────────────────────────────────────────────
    if norm ~ 'clasic|classical|sinfon|orquest|filarmoni|camara|opera|barroco' then
      canon := 'clasica';
    end if;

    -- ── Salsa / Tropical ─────────────────────────────────────────────────────
    if norm ~ '^salsa$|salsa dura|salsa romantica|tropical|bachata|merengue' then
      canon := 'salsa';
    end if;

    -- ── Cumbia ───────────────────────────────────────────────────────────────
    if norm ~ 'cumbia' then
      canon := 'cumbia';
    end if;

    -- ── → NULL explícito para géneros editorialmente excluidos ───────────────
    if norm ~ 'motivacional|conferencia|charla|musica peruana|musica andina|criollo|chicha|huayno|folklore|folklorico|industrial|shoegaze|progressive rock|prog rock|world music|new age|spoken word' then
      canon := null;
    end if;

    update public.genres
      set canonical_slug = canon
    where id = r.id
      and (canonical_slug is distinct from canon);

  end loop;
end;
$$;

-- ── 5. Vista actualizada ──────────────────────────────────────────────────────
-- DROP + CREATE porque PostgreSQL no permite CREATE OR REPLACE cuando cambia
-- el orden de columnas de una vista existente.
drop view if exists public.app_visible_events_catalog;
create view public.app_visible_events_catalog as
with genre_map as (
  select
    e.id,
    -- géneros raw (campo original — sin cambios)
    coalesce(
      array_agg(distinct g.slug) filter (where g.slug is not null),
      '{}'::text[]
    ) as genre_slugs,
    -- géneros canónicos (campo nuevo)
    coalesce(
      array_agg(distinct g.canonical_slug) filter (where g.canonical_slug is not null),
      '{}'::text[]
    ) as genres_canonical
  from public.events e
  left join public.event_genres eg on eg.event_id = e.id
  left join public.genres g on g.id = eg.genre_id
  group by e.id
)
select
  e.id,
  e.name,
  e.date,
  e.start_time,
  e.city,
  e.country_code,
  e.source,
  e.ticket_url,
  e.cover_url,
  e.is_active,
  gm.genre_slugs,
  gm.genres_canonical,
  public.app_event_visibility_reason(e.name, gm.genre_slugs) as visibility_reason,
  (
    e.is_active = true
    and e.cover_url is not null
    and public.app_event_visibility_reason(e.name, gm.genre_slugs) is null
  ) as is_visible_in_app
from public.events e
left join genre_map gm on gm.id = e.id
where
  e.is_active = true
  and e.cover_url is not null
  and public.app_event_visibility_reason(e.name, gm.genre_slugs) is null;

grant select on public.app_visible_events_catalog to anon, authenticated, service_role;
grant execute on function public._normalize_genre(text) to anon, authenticated, service_role;
