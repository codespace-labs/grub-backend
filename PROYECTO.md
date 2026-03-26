# grub — Biblia del Proyecto

> Documentación completa del sistema. Todo lo que existe, por qué existe, y cómo funciona.

---

## Estado de fuentes

| País | Fuente | Estado |
|------|--------|--------|
| PE | ticketmaster | activo |
| PE | ticketmaster.pe (scraper web) | activo |
| PE | teleticket | activo |
| MX | ticketmaster | activo |
| MX | superboletos | `enabled: false` (pendiente) |
| AR | ticketmaster | activo |
| US | ticketmaster | activo |
| ES | ticketmaster | activo |

---

## Índice

1. [Qué es grub](#1-qué-es-grub)
2. [Stack técnico](#2-stack-técnico)
3. [Estructura de carpetas](#3-estructura-de-carpetas)
4. [Base de datos (Supabase)](#4-base-de-datos-supabase)
5. [Backend — Edge Functions](#5-backend--edge-functions)
6. [Design System](#6-design-system)
7. [Componentes UI](#7-componentes-ui)
8. [Pantallas y navegación](#8-pantallas-y-navegación)
9. [Herramientas internas](#9-herramientas-internas)
10. [Géneros soportados](#10-géneros-soportados)
11. [Variables de entorno](#11-variables-de-entorno)
12. [Cómo levantar el proyecto](#12-cómo-levantar-el-proyecto)

---

## 1. Qué es grub

Aplicación móvil de **descubrimiento de eventos de música en Lima, Perú**.

El usuario puede explorar eventos por género, fecha y venue. Los eventos se obtienen automáticamente de fuentes externas (Ticketmaster, Teleticket) mediante scrapers que corren como Supabase Edge Functions en un cron diario.

**Público objetivo:** personas de 18–35 años en Lima interesadas en eventos de electrónica, reggaeton, salsa, rock, indie y géneros afines.

---

## 2. Stack técnico

| Capa | Tecnología |
|------|------------|
| App móvil | React Native + Expo 55 |
| Routing | Expo Router (file-based) |
| Lenguaje | TypeScript strict |
| Backend / DB | Supabase (Postgres + Edge Functions) |
| Edge Functions | Deno runtime |
| Íconos | lucide-react-native |
| Gradientes | expo-linear-gradient |
| Fuentes | Plus Jakarta Sans (headings) · DM Sans (body) |
| Design System | Figma DS · grub (`8bI7prpCMbbYFWZDgnQ3oY`) |

---

## 3. Estructura de carpetas

```
grub/
├── app/                          # Rutas (Expo Router)
│   ├── _layout.tsx               # Root layout (fonts, safe area)
│   ├── index.tsx                 # Showcase de componentes (dev only)
│   ├── (auth)/
│   │   └── login.tsx
│   ├── (onboarding)/
│   │   ├── genres.tsx            # Selección de géneros favoritos
│   │   ├── history.tsx           # Historial / preferencias previas
│   │   └── ready.tsx             # Pantalla de bienvenida final
│   └── (tabs)/
│       ├── _layout.tsx           # Tab navigation + BottomNav custom
│       ├── home.tsx              # Feed principal
│       ├── calendar.tsx          # Vista de calendario
│       └── profile.tsx           # Perfil del usuario
│
├── src/
│   ├── components/
│   │   ├── ui/                   # Átomos del DS
│   │   │   ├── AppText.tsx
│   │   │   ├── AppButton.tsx
│   │   │   ├── AppInput.tsx
│   │   │   ├── AppIcon.tsx
│   │   │   ├── AppChip.tsx
│   │   │   ├── Avatar.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── CategoryTag.tsx
│   │   │   ├── DateBadge.tsx
│   │   │   ├── Screen.tsx
│   │   │   ├── NavBar.tsx
│   │   │   ├── Effect.tsx
│   │   │   ├── FollowerCount.tsx
│   │   │   ├── AvatarStack.tsx
│   │   │   ├── StatItem.tsx
│   │   │   ├── StatsRow.tsx
│   │   │   ├── ProfileStats.tsx
│   │   │   └── TabItem.tsx
│   │   ├── cards/                # Tarjetas de evento
│   │   │   ├── EventCard.tsx
│   │   │   ├── EventCardHorizontal.tsx
│   │   │   ├── EventRow.tsx
│   │   │   ├── EventListItem.tsx
│   │   │   └── TopListItem.tsx
│   │   └── navigation/
│   │       └── BottomNav.tsx
│   ├── hooks/                    # Custom React hooks
│   │   └── useHomeEvents.ts      # Fetch featured/listed events + genres
│   ├── lib/                      # Utilidades externas
│   │   └── supabase.ts           # Cliente Supabase (anon key)
│   └── theme/                    # Tokens de diseño
│       ├── colors.ts
│       ├── spacing.ts
│       ├── typography.ts
│       ├── radius.ts
│       └── shadows.ts
│
├── supabase/
│   └── functions/
│       ├── _shared/
│       │   └── venue-upsert.ts   # Utilidad: upsert en venues, retorna UUID
│       ├── sync-ticketmaster/    # Sincronización con Ticketmaster API
│       │   └── index.ts
│       ├── sync-ticketmaster-pe/ # Scraper HTML de ticketmaster.pe/page/categoria-conciertos
│       │   └── index.ts          #   source="ticketmaster-pe", registrado en sync-global SOURCES
│       ├── sync-teleticket/      # Scraper de Teleticket.com.pe
│       │   └── index.ts
│       ├── enrich-artists/       # Enriquece artistas con MusicBrainz
│       │   └── index.ts
│       └── sync-global/          # Orquestador multi-país multi-fuente
│           └── index.ts
│
├── assets/
│   └── images/
│       └── icon.png              # 1024×1024, fondo #7133FF
│
├── grub-scraper-dashboard.html   # Dashboard interno de monitoreo
├── PROYECTO.md                   # Este archivo
└── app.json
```

---

## 4. Base de datos (Supabase)

### Proyecto
- **URL:** `https://xmdoaikmmhdzdzxovwzn.supabase.co`
- **Region:** (según configuración del proyecto)

### Migraciones aplicadas

**`supabase/migrations/20260316000000_event_detail_normalization.sql`** — schema: tablas nuevas + columnas en events.

**`supabase/migrations/20260316000001_backfill_existing_events.sql`** — datos: backfill de venue_id, source, artists y event_artists sobre los 157 eventos existentes.

### Tablas

#### `events`
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | auto |
| `name` | text | Nombre del evento |
| `date` | timestamptz | ISO 8601 — legacy, scrapers siguen escribiendo aquí |
| `start_time` | time \| null | Hora del evento separada de `date` |
| `venue` | text \| null | Fallback hasta que todos los rows tengan `venue_id` |
| `venue_id` | uuid FK → venues \| null | Venue normalizado (nullable) |
| `city` | text | Ya existente — se mantiene |
| `country_code` | char(2) | Default `'PE'` |
| `event_type` | text | `concert` \| `festival` \| `club_night` \| `showcase` \| `other` — default `concert` |
| `availability_status` | text | `available` \| `sold_out` \| `unknown` — default `available` |
| `source` | text | `ticketmaster` \| `teleticket` \| `manual` — default `manual` |
| `ticket_url` | text UNIQUE | Usado para deduplicar en upserts |
| `cover_url` | text \| null | URL de imagen de portada |
| `price_min` | numeric \| null | Precio mínimo en PEN |
| `price_max` | numeric \| null | Precio máximo en PEN |
| `lineup` | text[] | Legacy — reemplazado por `event_artists` |
| `description` | text \| null | Descripción del evento |
| `is_active` | boolean | `true` = visible en la app |

#### `venues`
Lugar físico del evento. Constraint UNIQUE en `(name, city)`.

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `name` | text NOT NULL | Nombre del venue |
| `address` | text \| null | Dirección completa |
| `city` | text NOT NULL | Ciudad |
| `country_code` | char(2) | Default `'PE'` |
| `lat` | decimal(9,6) \| null | Latitud |
| `lng` | decimal(9,6) \| null | Longitud |
| `created_at` | timestamptz | |

#### `artists`
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `name` | text NOT NULL | Nombre del artista |
| `slug` | text UNIQUE NOT NULL | e.g. `"bad-bunny"` |
| `photo_url` | text \| null | Foto del artista |
| `musicbrainz_id` | text UNIQUE \| null | ID en MusicBrainz para enriquecimiento futuro |
| `created_at` | timestamptz | |

#### `artist_genres`
Géneros musicales de un artista (N:M con `genres`).

| Columna | Tipo |
|---------|------|
| `artist_id` | uuid FK → artists.id |
| `genre_id` | bigint FK → genres.id |

#### `event_artists`
Artistas que participan en un evento. Reemplaza el array `lineup`.

| Columna | Tipo | Notas |
|---------|------|-------|
| `event_id` | uuid FK → events.id | |
| `artist_id` | uuid FK → artists.id | |
| `order_index` | smallint | Posición en el lineup (0-based, 0 = headliner) |

#### `genres`
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | bigint PK | auto-incremental (SERIAL / IDENTITY) |
| `slug` | text UNIQUE | e.g. `"techno"`, `"reggaeton"` |
| `name` | text | Nombre legible |
| `created_at` | timestamptz | |

#### `event_genres`
Géneros de un evento (N:M con `genres`).

| Columna | Tipo |
|---------|------|
| `event_id` | uuid FK → events.id |
| `genre_id` | bigint FK → genres.id |

#### `artist_genres`
_(ver arriba — `genre_id` es `BIGINT` para coincidir con `genres.id`)_

### Query — detalle de evento

```sql
SELECT
  e.*,
  v.address, v.lat, v.lng,
  json_agg(DISTINCT jsonb_build_object(
    'name', a.name, 'photo_url', a.photo_url,
    'genres', (
      SELECT json_agg(g.slug)
      FROM artist_genres ag JOIN genres g ON g.id = ag.genre_id
      WHERE ag.artist_id = a.id
    )
  )) FILTER (WHERE a.id IS NOT NULL) AS artists,
  json_agg(DISTINCT jsonb_build_object('slug', g2.slug, 'name', g2.name))
    FILTER (WHERE g2.id IS NOT NULL) AS genres
FROM events e
LEFT JOIN venues v         ON v.id = e.venue_id
LEFT JOIN event_artists ea ON ea.event_id = e.id
LEFT JOIN artists a        ON a.id = ea.artist_id
LEFT JOIN event_genres eg  ON eg.event_id = e.id
LEFT JOIN genres g2        ON g2.id = eg.genre_id
WHERE e.id = '<uuid>'
GROUP BY e.id, v.address, v.lat, v.lng;
```

### RLS

Todas las tablas tienen lectura pública y escritura solo vía service_role (Edge Functions).

```sql
-- Ya aplicado en la migración:
-- venues, artists, artist_genres, event_artists → enable RLS + public read policy
-- events, event_genres, genres → enable RLS + public read (configurado previamente)
```

---

## 5. Backend — Edge Functions

Las Edge Functions corren en **Deno** en el runtime de Supabase. Se despliegan con el CLI de Supabase y se invocan via HTTP POST.

### Nota de auth para `api-admin-*`

Las Edge Functions del backoffice (`api-admin-*`) usan autorización interna con `requireAdmin()` desde `supabase/functions/_shared/admin-auth.ts`.

Eso implica que:
- la validación real de usuario y rol vive dentro de la function
- el rol permitido se controla con `viewer`, `operator`, `admin` o `superadmin`
- estas functions deben desplegarse con `--no-verify-jwt`

Motivo:
- si la gateway de Supabase Functions también intenta validar el JWT antes de ejecutar la function, aparece una doble auth
- en ese escenario puede ocurrir un `401 Invalid JWT` en la gateway aunque el mismo token sí sea aceptado por `auth/v1/user`
- el síntoma típico en backoffice es que `/api/auth/debug` devuelve `userCheck.status = 200` pero `adminEventsCheck.status = 401`

Regla operativa:
- `api-admin-*`: desplegar con `--no-verify-jwt`
- functions públicas: decidir caso por caso según si dependen de auth interna o auth del gateway
- workers/sync: normalmente también se despliegan con `--no-verify-jwt` porque suelen autenticarse con secrets internos, cron o service role

### `_shared/venue-upsert.ts`

**Archivo:** `supabase/functions/_shared/venue-upsert.ts`

Utilidad compartida por todas las Edge Functions que necesitan garantizar la existencia de un venue en DB.

**Firma:**
```typescript
export interface VenueInput {
  name:          string;
  city:          string;
  country_code?: string;   // default 'PE'
  address?:      string;
  lat?:          number;
  lng?:          number;
}

export async function upsertVenue(
  supabase: SupabaseClient,
  input: VenueInput,
): Promise<string | null>   // retorna venue UUID o null si falla
```

**Comportamiento:**
- `onConflict: "name,city"` — coincide con `UNIQUE (name, city)` en la tabla venues
- `ignoreDuplicates: false` — en conflicto actualiza los campos enviados (merge), preservando los existentes que no se pasen
- Solo incluye campos opcionales (`address`, `lat`, `lng`) si se proporcionan en el input

**Uso:**
```typescript
import { upsertVenue } from "../_shared/venue-upsert.ts";

const venueId = await upsertVenue(supabase, {
  name: "Estadio Nacional",
  city: "Lima",
  lat:  -12.0697,
  lng:  -77.0331,
});
```

---

### `sync-ticketmaster`

**Archivo:** `supabase/functions/sync-ticketmaster/index.ts`

**Qué hace:**
1. Llama a la Ticketmaster Discovery API v2 paginando de 50 en 50
2. Filtra por `countryCode=PE` y `classificationName=music`
3. Por cada evento: mapea los campos al schema de `events`, hace upsert por `ticket_url`
4. Infiere géneros desde las classifications de TM (con fallback a keyword scan del nombre)
5. Inserta en `event_genres` enlazando el evento con sus géneros

**Variables de entorno:**
```
TM_API_KEY=<tu api key de Ticketmaster>
# SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son inyectadas automáticamente
```

**Deploy:**
```bash
supabase functions deploy sync-ticketmaster --no-verify-jwt
```

**Cron (SQL Editor de Supabase — requiere pg_cron + pg_net):**
```sql
SELECT cron.schedule(
  'sync-ticketmaster-daily',
  '0 8 * * *',  -- 8am UTC = 3am Lima (UTC-5)
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/sync-ticketmaster',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  )
  $$
);
```

**Lógica de inferencia de géneros:**

| TM genre | TM subGenre | Slug grub |
|----------|-------------|-----------|
| Techno | — | techno |
| Tech House / House / Deep House | — | house |
| Electronic / EDM / Dance | — | electronica |
| Hip-Hop/Rap | — | hip-hop |
| Rock | — | rock |
| Alternative / Indie Rock | — | indie |
| Latin | Salsa | salsa |
| Latin | Cumbia | cumbia |
| Latin | Reggaeton | reggaeton |
| Latin | (otro) | latin-bass |

Si las classifications no dan resultado, escanea el nombre del evento con regex.

---

### `sync-teleticket`

**Archivo:** `supabase/functions/sync-teleticket/index.ts`

**Estado actual:** implementación completa y funcional.

**Qué hace:**
1. Fetch de HTML de `https://teleticket.com.pe/conciertos` con headers de navegador
2. Parsea el HTML con regex puro (sin dependencias externas — compatible con Deno Edge)
3. Upsert en `events` igual que sync-ticketmaster
4. Inferencia de géneros solo por keyword scan (Teleticket no tiene classifications)

**Estructura HTML scrapeada (verificada 2026-03):**
```
<article class="filtr-item event-item col-6">
  <a href="/event-slug">                         → ticket_url
    <div class="aspect__inner">
      <img src="https://cdn.teleticket..." >     → cover_url
    </div>
    <p class="descripcion"><strong>VENUE</strong>  → venue
    <h3 title="NOMBRE EVENTO">                  → name
    <p v-html="getDate(['2026-05-24', ...]">    → date (ISO)
  </a>
</article>
```

**Nota:** Todos los eventos están en una sola página (sin paginación). `price_min` siempre `null` — el precio no está disponible en el listado.

**Deploy:**
```bash
supabase functions deploy sync-teleticket --no-verify-jwt
```

**Cron:** `30 8 * * *` (8:30am UTC — 30 min después de Ticketmaster)

**Schema de evento scrapeado (`RawEvent`):**
```typescript
interface RawEvent {
  name:       string;
  date:       string | null;   // ISO o string cruda del sitio
  venue:      string | null;
  ticket_url: string;          // URL de la página del evento
  cover_url:  string | null;
  price_min:  number | null;
}
```

**Nota para implementar `parseEvents`:** inspeccionar los selectores en DevTools en `teleticket.com.pe/conciertos`. El HTML puede cambiar — si falla, revisar los selectores.

---

### `enrich-artists`

**Archivo:** `supabase/functions/enrich-artists/index.ts`

**Estado actual:** implementación completa y funcional.

**Qué hace:**
1. Lee artistas de `artists` donde `musicbrainz_id IS NULL`, en batches de 50
2. Por cada artista llama a `https://musicbrainz.org/ws/2/artist?query=artist:{name}&fmt=json&limit=1` con `User-Agent: Grub/1.0 (sthefanyflorianog@gmail.com)`
3. Si el score >= 70, guarda el `musicbrainz_id`
4. Si el artista no tiene foto, hace un segundo call (`/artist/{mbid}?inc=url-rels`) para buscar imagen en Wikimedia Commons
5. Vincula los tags de MusicBrainz con `genres` via `artist_genres` (ON CONFLICT DO NOTHING)
6. Respeta el rate limit de MusicBrainz: 1100ms entre requests

**Variables de entorno:** `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (inyectadas automáticamente por Supabase).

**Retorna:**
```json
{ "enriched": 12, "skipped": 0, "failed": 1, "no_match": 3 }
```

**Deploy:**
```bash
supabase functions deploy enrich-artists --no-verify-jwt
```

**Cron sugerido:** `0 9 * * 1` (lunes 9am UTC) — correr semanalmente después de que entren nuevos artistas vía sync-ticketmaster o sync-teleticket.

---

### `sync-global`

**Archivo:** `supabase/functions/sync-global/index.ts`

**Estado actual:** implementación completa y funcional.

**Qué hace:**
Dispatcher central que invoca en paralelo cada Edge Function de sincronización según el registro `SOURCES`. Permite controlar países y fuentes desde un único endpoint.

**Fuentes registradas:**

| País | Fuente | Estado |
|------|--------|--------|
| PE | ticketmaster | activo |
| PE | teleticket | activo |
| MX | ticketmaster | activo |
| MX | superboletos | `enabled: false` (pendiente) |
| AR | ticketmaster | activo |
| US | ticketmaster | activo |
| ES | ticketmaster | activo |

**Body de la request (todos opcionales):**
```json
{ "countries": ["PE", "MX"], "sources": ["ticketmaster"] }
```
Si no se pasa nada → corre todos los países y fuentes activos.

**Response:**
```json
{
  "started_at": "...",
  "finished_at": "...",
  "results": [
    { "source": "ticketmaster", "country": "PE", "status": "success", "inserted": 24, "durationMs": 3200 }
  ],
  "total_inserted": 980,
  "total_failed": 0
}
```

**Cómo agregar un país o scraper nuevo:**
1. Añadir entrada en `SOURCES` en `sync-global/index.ts`
2. Si es fuente nueva: crear `supabase/functions/sync-{type}/index.ts` con handler POST que retorne `{ inserted, updated, failed }`
3. No es necesario modificar el orquestador

**Deploy:**
```bash
supabase functions deploy sync-global --no-verify-jwt
```

**Cron diario:** `0 3 * * *` (3am UTC).

---

## 6. Design System

**Figma:** [DS · grub](https://www.figma.com/design/8bI7prpCMbbYFWZDgnQ3oY/DS)

Todo el sistema de diseño vive en `src/theme/`. Los componentes nunca usan valores mágicos — todos los valores vienen de los tokens.

### Colores (`src/theme/colors.ts`)

**Paleta primitiva (`palette`):**

| Escala | Valores clave |
|--------|--------------|
| `purple` | 50 → 900. Brand color. `purple[500]` = `#7133FF` |
| `neutral` | 0 (blanco) → 1000 (casi negro). `neutral[950]` = `#080C14` (bg principal) |

**Semánticos (`semantic`):**
- `background` = `neutral[1000]`
- `surface` = `neutral[950]`
- `textPrimary` = `neutral[0]`
- `primary` = `purple[500]` (`#7133FF`)

### Espaciado (`src/theme/spacing.ts`)

Escala de 12 pasos (0–11):

| Key | px |
|-----|----|
| 0 | 0 |
| 1 | 2 |
| 2 | 4 |
| 3 | 8 |
| 4 | 12 |
| 5 | 16 |
| 6 | 24 |
| 7 | 32 |
| 8 | 40 |
| 9 | 48 |
| 10 | 56 |
| 11 | 64 |

### Tipografía (`src/theme/typography.ts`)

**Fuentes:** Plus Jakarta Sans (headings) · DM Sans (body)

| Variante | Font | Size | Weight | Uso |
|----------|------|------|--------|-----|
| `heading3xl` | PJS | 32 | 700 | Títulos grandes |
| `heading2xl` | PJS | 24 | 700 | Sección principal |
| `headingXl` | PJS | 20 | 600 | Nombre de evento (card) |
| `headingMd` | PJS | 16 | 700 | Nombre en card horizontal |
| `buttonMd` | PJS | 16 | 700 | Botones principales |
| `buttonSm` | DM | 14 | 500 | CategoryTag |
| `bodyMd` | DM | 16 | 400 | Texto general |
| `captionSemibold` | DM | 12 | 600 | Fecha, venue, precio |
| `caption` | DM | 12 | 500 | Textos secundarios |

### Radio (`src/theme/radius.ts`)

| Token | px | Uso |
|-------|----|-----|
| `none` | 0 | — |
| `sm` | 12 | Cards menores |
| `lg` | 24 | Cards principales (EventCard) |
| `full` | 999 | Pills, avatares |

> **Nota:** Figma usa 8px, 10px y 16px en algunos componentes — estos valores no tienen token DS y se declaran como constantes locales en cada componente.

### Sombras (`src/theme/shadows.ts`)

| Token | Uso |
|-------|-----|
| `e0` | Sin sombra |
| `e1` | Sombra sutil |
| `e2` | EventCard principal |
| `e3` | Elementos flotantes |
| `borderGlow` | Borde blanco al 8% (decorativo) |

---

## 7. Componentes UI

### Reglas generales de implementación

- Todos usan `StyleSheet.create` — sin estilos inline
- Los valores vienen de `src/theme/*` — sin literales numéricos huérfanos
- Valores no presentes en el DS se documentan como constantes locales con comentario Figma
- Nunca componer Pressables anidados (Android intercepta eventos de touch)

---

### Átomos (`src/components/ui/`)

#### `AppText`
Wrapper de `Text` que mapea variantes del DS a estilos tipográficos. Props: `variant`, `color`, `numberOfLines`, `style`.

#### `AppButton`
Botón con variantes (`primary`, `secondary`, `ghost`). Usa `buttonMd` y `primary` del DS.

#### `AppInput`
Input de texto con border, placeholder y estados de foco.

#### `AppIcon`
Wrapper de lucide-react-native. Props: `icon` (componente), `size`, `color`.

#### `CategoryTag`
Tag de género con estado `isSelected`.
- **Seleccionado:** fondo `rgba(113,51,255,0.2)` + borde `purple[500]`
- **No seleccionado:** `LinearGradient` de `neutral[900]` → `rgba(31,41,51,0.7)`
- Tipografía: `buttonSm`

#### `Avatar`
Imagen circular con fallback a iniciales.
- Border: `neutral[900]`, width `1.5`
- Bg fallback: `neutral[800]`
- Iniciales: `neutral[300]`

#### `DateBadge`
Badge compacto `42×50px` que muestra día de la semana + número del día.
- Bg: `rgba(255,255,255,0.08)`
- Border: `neutral[900]`
- Número: Plus Jakarta Sans Bold 18px (sin token DS — constante local)

#### `Screen`
Safe area wrapper. Fondo `semantic.background`. Padding estándar.

#### `Badge`
Badge genérico con texto corto (notificaciones, contadores).

#### `FollowerCount`
Chip que muestra conteo de amigos asistiendo (e.g. "+ 5 amigos asistirán").
- Bg: `neutral[800]`, border 1.5px `neutral[900]`, radius 8px
- Tamaños: `sm` (paddingV 4px) y `lg` (paddingV 8px)
- Tipografía: `caption` (DM Sans Medium 12px)

#### `AvatarStack`
Fila de avatares superpuestos + chip `FollowerCount`.
- Overlap: −10px entre cada avatar
- Tamaños: `sm` (24px) y `lg` (32px)
- Configurable con `uris[]` y `followerText`

#### `StatItem`
Card de estadística individual (conteo + etiqueta).
- Bg: `neutral[900]`, radius 12px, altura 64px
- Etiquetas: `"Próximos"` | `"Este año"` | `"Total"`
- Count: PJS Bold 18px (constante local — sin token DS)

#### `StatsRow`
Fila de 3 `StatItem` con gap 4px.
- Props: `upcomingCount`, `yearCount`, `totalCount`

#### `ProfileStats`
Contenedor completo de estadísticas de perfil.
- Bg: `neutral[950]`, border `rgba(255,255,255,0.05)`, radius 16px, padding 4px
- Contiene: `StatsRow` + fila de seguidores (`neutral[900]`) con `AvatarStack`

#### `TabItem`
Tab individual con estado seleccionado/no seleccionado.
- Seleccionado: borde inferior 2px `purple[500]`, PJS ExtraBold 16px
- No seleccionado: borde inferior 2px `neutral[700]`, PJS Bold 16px

---

### Cards (`src/components/cards/`)

#### `EventCard`
Card vertical principal. **Figma node 1:742.**
- Dimensiones: `300×375px`
- Cover con `blurRadius={2}` + `LinearGradient` (transparent → `neutral[950]`)
- Badge de categoría (top-left): fondo semi-transparente, borde blanco
- Info (bottom): título `headingXl`, fecha + venue con iconos Calendar/MapPin
- Avatar stack + social proof opcional
- Sombra: `shadows.e2`

#### `EventCardHorizontal`
Card horizontal compacta. **Figma node 1:801.**
- Dimensiones: `361×135px`
- Imagen izquierda `aspectRatio: 123.2/154`, radio local `10px`
- Info derecha: título `headingMd`, fecha + venue, precio en `purple[300]`
- `DEFAULT_IMAGE` de Unsplash como fallback

#### `EventRow`
Card horizontal de fila con imagen de fondo. **Figma node 1:822.**
- Dimensiones: `295×135px`
- Usa ícono `Clock` + prop `time` (no `date`)
- `LinearGradient` vertical sobre la imagen
- Sin badge de categoría

#### `EventListItem`
Compuesto: `DateBadge` + contenido de `EventRow` inline (sin Pressable anidado). **Figma node 1:845.**
- Layout: `flexRow`, gap `24px`
- Inlinea el contenido visual de EventRow para evitar Pressables anidados en Android

#### `TopListItem`
Compuesto: `DateBadge` (variante ranking) + EventRow con fecha en lugar de hora.
- DateBadge: `dayName="Top"`, `dayNumber=rank` (e.g. "1")
- EventRow interno: icono `Calendar` + fecha + venue (sin campo de hora)
- Layout: `flexRow`, gap `24px`

---

### Navegación (`src/components/navigation/`)

#### `BottomNav`
Tab bar custom con 3 tabs: **Home · Calendar · Profile**.
- Posición `absolute`, bottom `spacing[7]` (32px)
- Iconos de lucide-react-native

---

## 8. Pantallas y navegación

### Flujo de navegación

```
Root (_layout.tsx)
├── (auth)
│   └── /login
├── (onboarding)
│   ├── /genres       ← selección de géneros favoritos
│   ├── /history      ← preferencias de historial
│   └── /ready        ← pantalla final de onboarding
└── (tabs)            ← app principal
    ├── /home         ← feed de eventos
    ├── /calendar     ← vista de calendario
    └── /profile      ← perfil del usuario
```

### Tab navigation

El layout `(tabs)/_layout.tsx` oculta el tab bar nativo de Expo Router (`tabBarStyle: display none`) y usa el componente `BottomNav` custom posicionado con `position: absolute`.

### Pantalla `/home`

**Archivo:** `app/(tabs)/home.tsx`

**Layout:**
- Fondo `neutral[1000]` + gradiente lineal vertical purple (`rgba(113,51,255,0.35)` → transparente, altura 280px)
- Sección **Recomendados**: título PJS Bold 24px
- **Carousel horizontal** (`ScrollView` snapping): `EventCard` de eventos próximos (limit 10), con snap a 316px (300px card + 16px gap)
- **FilterBar horizontal**: `CategoryTag` con chip "Todos" + géneros de la BD
- **Lista vertical**: `EventCardHorizontal` filtrados por género seleccionado (limit 20)
- `paddingBottom: 100` para dejar espacio al BottomNav flotante

**Data:**
- Fuente: Supabase vía `src/hooks/useHomeEvents.ts`
- Carousel: `events` JOIN `venues` JOIN `event_genres(genres)` WHERE `is_active=true AND date >= now()` ORDER BY `date` LIMIT 10
- Géneros: tabla `genres` ORDER BY `name` LIMIT 30
- Lista: igual que carousel pero LIMIT 20, filtrando por `event_genres.genre_id` cuando hay género activo

---

## 9. Herramientas internas

### `grub-scraper-dashboard.html`

Dashboard de monitoreo single-page para validar que los scrapers funcionan. Se abre directamente en el browser. **No es parte de la app.**

**Cómo usarlo:**
```bash
# desde la raíz del proyecto
npx serve . -p 5500
```

Luego abrir `http://localhost:5500/grub-scraper-dashboard.html`.

**Qué muestra:**
- Métricas: total eventos, con cover, sin géneros, próximos 30 días
- Filtros por fuente (Ticketmaster / Teleticket), género y búsqueda de nombre
- Tabla de hasta 100 eventos con: cover, nombre, fecha formateada, géneros (chips con colores), precio, fuente (badge TM/TT), link
- Detección de duplicados: Sørensen-Dice sobre bigramas de caracteres (umbral > 0.80). Filas duplicadas se marcan con borde rojo + badge `dup`
- Estado de crons: muestra el evento más reciente por fuente como proxy de última ejecución exitosa
- Botón "Actualizar datos" para re-fetch sin recargar la página

**Detección de fuente** (por `ticket_url`):
- Contiene `ticketmaster` → `TM` (azul)
- Contiene `teleticket` → `TT` (naranja)
- Resto → `—`

**Ref en la app:** `app/(tabs)/home.tsx` tiene un link `🛠 Scraper Dashboard →` que abre la URL del dashboard en el browser del emulador.

---

## 10. Géneros soportados

| Slug | Display | Color (dashboard) |
|------|---------|-------------------|
| `techno` | Techno | purple |
| `house` | House | blue |
| `reggaeton` | Reggaeton | green |
| `salsa` | Salsa | red |
| `cumbia` | Cumbia | amber |
| `rock` | Rock | gray |
| `hip-hop` | Hip-Hop | orange |
| `indie` | Indie | teal |
| `electronica` | Electronica | cyan |
| `latin-bass` | Latin Bass | pink |

Estos slugs deben existir en la tabla `genres` de Supabase para que el linking de `event_genres` funcione. Si un slug no existe, `linkGenres` lo loggea como `warn` y lo omite.

---

## 11. Variables de entorno

### App (Expo)

En `.env` en la raíz (prefijo `EXPO_PUBLIC_` para exponer al cliente):

```env
EXPO_PUBLIC_SUPABASE_URL=https://xmdoaikmmhdzdzxovwzn.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

### Edge Functions (Supabase Dashboard → Edge Functions → Variables)

| Variable | Fuente | Notas |
|----------|--------|-------|
| `TM_API_KEY` | Manual | API key de Ticketmaster |
| `SUPABASE_URL` | Automática | Inyectada por Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Automática | Inyectada por Supabase |

---

## 12. Cómo levantar el proyecto

### App

```bash
npm install
npm start          # Expo DevTools — escanear QR con Expo Go
npm run ios        # Simulador iOS
npm run android    # Emulador Android
npm run web        # Navegador
```

### Dashboard de monitoreo

```bash
npx serve . -p 5500
# Abrir: http://localhost:5500/grub-scraper-dashboard.html
```

### Edge Functions (desarrollo local)

```bash
supabase start
supabase functions serve sync-ticketmaster --env-file .env.local
```

### Deploy de Edge Functions

```bash
supabase functions deploy sync-ticketmaster --no-verify-jwt
supabase functions deploy sync-teleticket   --no-verify-jwt
supabase functions deploy enrich-artists    --no-verify-jwt
supabase functions deploy sync-global       --no-verify-jwt
```

```bash
supabase functions deploy api-admin-events             --no-verify-jwt --project-ref <project-ref>
supabase functions deploy api-admin-normalization      --no-verify-jwt --project-ref <project-ref>
supabase functions deploy api-admin-users              --no-verify-jwt --project-ref <project-ref>
supabase functions deploy api-admin-event-deactivate   --no-verify-jwt --project-ref <project-ref>
supabase functions deploy api-admin-quality-issues     --no-verify-jwt --project-ref <project-ref>
supabase functions deploy api-admin-quality-issue-status --no-verify-jwt --project-ref <project-ref>
supabase functions deploy api-admin-manual-overrides   --no-verify-jwt --project-ref <project-ref>
supabase functions deploy api-admin-source-sync        --no-verify-jwt --project-ref <project-ref>
```

> `_shared/` no se despliega por separado — Supabase lo incluye automáticamente como parte de cada función que lo importa.

---

## 13. Decisión de arquitectura: Auth != Perfil

Decisión acordada:

- la identidad/autenticación del usuario no debe mezclarse con el dominio de perfil
- `public.users` debe ser la base de identidad del usuario
- el perfil y las features sociales deben vivir en tablas separadas

Motivación:

- auth cambia distinto que perfil
- perfil/social crece más rápido y requiere otros índices, políticas y métricas
- separar dominios evita sobrecargar `users` con campos de UI o producto
- el backoffice puede administrar usuarios sin acoplarse a todo el dominio social

Dirección propuesta para backend:

- `public.users`
  - identidad base
  - source (`backoffice` / `customer`)
  - provider (`google` / `apple` / `phone`)
  - referencias externas (`clerk_user_id`, `supabase_user_id`)
  - email, phone, display_name mínimo
  - estado de verificación
  - timestamps de creación / actualización / último acceso

- `public.user_profiles`
  - `user_id`
  - `username`
  - `bio`
  - `avatar_url`
  - `cover_url`
  - otros campos de presentación del perfil

- `public.user_stats`
  - `user_id`
  - `upcoming_count`
  - `year_count`
  - `total_count`
  - contadores derivados y recalculables

- `public.user_follows`
  - `follower_user_id`
  - `followed_user_id`
  - timestamps

- `public.user_event_activity`
  - `user_id`
  - `event_id`
  - `status`
  - `saved_at`
  - `attended_at`
  - u otras interacciones del usuario con eventos

- `public.user_settings`
  - `user_id`
  - preferencias
  - privacidad
  - toggles de producto

Alcance actual:

- esto queda documentado como dirección oficial
- todavía no está priorizado implementarlo completo
- cuando se retome, debemos diseñar primero el modelo de datos y luego las APIs/admin views correspondientes
