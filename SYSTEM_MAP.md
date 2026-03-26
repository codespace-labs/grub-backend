# Grub Backend System Map

Mapa operativo del backend de Grub: qué tablas existen, cuál es la fuente de verdad, qué hace cada Edge Function y cómo fluye la data desde scrapers hasta app y backoffice.

## 1. Resumen del sistema

Grub es una app de descubrimiento de eventos musicales. El backend corre sobre Supabase y está compuesto por:

- Postgres con tablas transaccionales, tablas de soporte operativo y tablas de normalización
- Edge Functions para scrapers, APIs públicas y APIs admin
- Un orquestador (`sync-global`) que dispara scrapers y registra corridas
- Un pipeline de normalización musical para artistas/géneros

El sistema hoy usa un modelo de transición:

- `events` sigue existiendo como tabla principal de compatibilidad
- `event_sources`, `event_occurrences`, `event_search` y `event_assets` son las tablas nuevas especializadas
- varios reads siguen saliendo de `events` o de vistas construidas sobre `events`

## 2. Qué tabla manda sobre cada dato

La forma simple de pensar el sistema hoy es esta:

1. los scrapers traen la data
2. esa data se guarda en la base
3. luego normalización, quality checks, overrides manuales y APIs trabajan sobre esa data

`events` sigue siendo la tabla central del sistema, pero ya no debería cargar sola con toda la verdad. La idea del refactor es repartir mejor las responsabilidades.

### `public.events`
- Qué es: la tabla central/base del evento
- Qué representa:
  - identidad interna del evento
  - nombre base
  - estado general del evento dentro del sistema
  - compatibilidad con APIs y backoffice existentes
- Cómo pensarla:
  - hoy sigue siendo la tabla principal operativa
  - pero ya no debería ser la única tabla dueña de todo

### `public.event_sources`
- Nombre humano: `fuentes del evento`
- Qué es: la tabla oficial de la fuente externa del evento
- Aquí debería mandar:
  - de qué fuente viene (`ticketmaster`, `teleticket`, etc.)
  - `ticket_url`
  - `external_slug`
  - precio observado en esa fuente
  - disponibilidad observada en esa fuente
  - última vez que el scraper vio ese evento

Piensa esta tabla así:
- aquí guardas de qué ticketera vino el evento
- aquí viven la URL, el slug externo, el precio y la disponibilidad que observó el scraper
- si mañana el mismo evento existe en dos ticketeras, aquí se separa eso sin romper `events`

### `public.event_occurrences`
- Nombre humano: `fechas y lugar del evento`
- Qué es: la tabla oficial de fecha/hora/venue del evento
- Aquí debería mandar:
  - `starts_at`
  - `local_date`
  - `start_time`
  - `venue_id`
  - snapshot de ciudad/país/venue para esa ocurrencia
  - estado de la ocurrencia

Piensa esta tabla así:
- aquí guardas cuándo ocurre el evento y dónde ocurre
- si un evento tiene varias funciones, varias fechas o varias sesiones, aquí vivirían
- hoy normalmente hay una fila principal por evento, pero el nombre existe para que el modelo crezca bien

### `public.event_search`
- Qué es: la tabla oficial para búsqueda y recomendación
- Aquí debería mandar:
  - texto indexable
  - `tsvector`
  - embedding
  - artistas primarios denormalizados
  - géneros denormalizados para búsqueda

### `public.event_assets`
- Nombre humano: `archivos del evento`
- Qué es: la tabla oficial de imágenes y otros assets del evento
- Aquí debería mandar:
  - cover
  - poster
  - gallery/video

Piensa esta tabla así:
- aquí guardas archivos o URLs asociadas al evento
- hoy sobre todo imágenes
- el nombre `assets` es solo una forma técnica de decir “archivos o recursos del evento”

### `public.venues`
- Qué es: la tabla oficial de venues
- Aquí debería mandar:
  - nombre del venue
  - ciudad
  - país
  - lat/lng
  - tipo de venue

### `public.event_artists`
- Qué es: la tabla oficial del lineup
- Aquí debería mandar:
  - qué artistas participan
  - en qué orden aparecen
- `events.lineup` queda como dato legacy/compat temporal

### `public.event_genres`
- Qué es: la tabla oficial de géneros del evento
- Aquí debería mandar:
  - qué géneros tiene asignado el evento

## 3. Tablas por schema

## `public`

### `events`
- Qué es: evento base y capa legacy de compatibilidad
- La siguen usando:
  - APIs públicas
  - backoffice
  - scrapers como espejo temporal
  - normalización
- Columnas legacy a deprecar gradualmente:
  - `lineup`
  - `venue`
  - `city`
  - `ticket_url`
  - `external_slug`
  - `price_min`
  - `price_max`
  - `availability_status`
  - `embedding`
  - `date`, `start_time`, `starts_at` cuando `event_occurrences` sea la fuente única

### `event_sources`
- Nombre humano: `fuentes del evento`
- Qué es: una fila por evento-fuente principal durante la transición
- Guarda:
  - identidad externa
  - estado observado por fuente
  - última observación
  - checksum operativo
- Se usa para deduplicación de scrapers

### `event_occurrences`
- Nombre humano: `fechas y lugar del evento`
- Qué es: ocurrencia principal del evento durante esta fase
- Guarda:
  - `starts_at`
  - `local_date`
  - `start_time`
  - `venue_id`
  - snapshot de `venue_name`, `city`, `country_code`
- Hoy hay una ocurrencia primaria por evento, pero la tabla ya permite crecer a múltiples funciones

### `event_search`
- Qué es: proyección denormalizada para search
- Guarda:
  - `searchable_text`
  - `search_document`
  - `embedding`
  - artistas y géneros denormalizados

### `event_assets`
- Nombre humano: `archivos del evento`
- Qué es: repositorio de assets del evento
- Hoy se llena al menos con la portada primaria

### `venues`
- Qué es: catálogo canónico de venues
- Los scrapers normalizan venue/city y hacen upsert aquí

### `artists`
- Qué es: catálogo canónico de artistas
- Se usa en:
  - `event_artists`
  - `artist_genres`
  - enriquecimiento vía MusicBrainz/Discogs

### `genres`
- Qué es: catálogo canónico de géneros

### `event_artists`
- Qué es: relación evento ↔ artista
- Reemplaza `events.lineup`

### `event_genres`
- Qué es: relación evento ↔ género

### `artist_genres`
- Qué es: relación artista ↔ género

### `event_media`
- Qué es: media subido por usuarios asociada a un evento

### `users`, `user_events`, `user_genres`, `follows`
- Qué es: capa social/personalización de usuario

## `ingestion`

### `sync_runs`
- Qué es: corrida global o manual de scrapers
- Guarda:
  - origen del trigger
  - countries
  - source filters
  - estado agregado
  - resumen

### `sync_run_items`
- Qué es: resultado por fuente/país dentro de una corrida
- Guarda:
  - inserted / updated / failed / skipped
  - duration
  - error_message
  - metadata

## `admin`

### `manual_event_overrides`
- Nombre humano: `correcciones manuales del evento`
- Qué es: correcciones manuales aplicadas sobre campos de eventos
- Se usan para:
  - corregir datos que vinieron mal del scraper
  - ajustar presentación o copy desde backoffice
  - dejar un valor manual por encima del valor automático
- `override` aquí significa:
  - “forzar manualmente un valor que reemplaza al automático”

### `audit_logs`
- Qué es: bitácora administrativa

## `quality`

### `quality_issues`
- Qué es: issues detectados automáticamente sobre eventos
- Ejemplos:
  - venue faltante
  - ciudad filtrándose en el título
  - inconsistencias de géneros

### `quality.event_quality_issues` (view)
- Qué es: vista que genera issues potenciales desde reglas

## `normalization`

### `raw_inputs`
- payloads crudos consultados a proveedores externos

### `artist_aliases`
- aliases conocidos para resolver matching de artistas

### `genre_synonyms`
- valores crudos y sinónimos que mapean a géneros canónicos

### `cache_entries`
- caché de resultados de normalización

### `runs`
- ejecuciones del pipeline de normalización

### `evidence`
- evidencia usada en una corrida de normalización

### `review_queue`
- items abiertos para revisión humana

### `event_classifications`
- clasificación principal de género por evento

## 4. Edge Functions y qué hace cada una

## Scrapers / workers de ingesta

### `sync-ticketmaster`
- Fuente: Ticketmaster Discovery API
- Uso actual:
  - no se usa para `PE`
  - sí puede usarse para otros países/markets
- Escribe:
  - `events`
  - `event_sources`
  - `event_occurrences`
  - `event_assets`
  - `event_genres`

### `sync-ticketmaster-pe`
- Fuente: scraper web de ticketmaster.pe
- Es la integración oficial de Ticketmaster para Perú
- Escribe:
  - `events`
  - `event_sources`
  - `event_occurrences`
  - `event_assets`
  - `event_genres`

### `sync-teleticket`
- Fuente: scraper web de teleticket.com.pe
- Escribe:
  - `events`
  - `event_sources`
  - `event_occurrences`
  - `event_assets`
  - `event_genres`

### `sync-global`
- Orquestador
- Qué hace:
  - elige fuentes por país
  - dispara scrapers por HTTP
  - registra `sync_runs` y `sync_run_items`
  - lanza normalización y enrich de artistas si hubo inserciones
- Regla actual:
  - por defecto quedó restringido a `PE` si no se pasan `countries`

### `enrich-artists`
- Enriquece artistas con fuentes externas
- Alimenta `artists`, `artist_genres` y campos relacionados de enriquecimiento

## APIs públicas

### `api-public-events`
- Catálogo público filtrable

### `api-public-event-detail`
- Detalle de evento

### `api-public-feed-home`
- Feed home público

### `api-public-genres`
- Lista de géneros

### `api-public-artists`
- Lista / lookup de artistas

### `api-public-auth-send-otp`
### `api-public-auth-verify-otp`
- Auth pública por OTP

## APIs admin / backoffice

### `api-admin-events`
- CRUD y listado de eventos del backoffice

### `api-admin-event-deactivate`
- Activa/desactiva eventos

### `api-admin-normalization`
- Dashboard y ejecución de normalización

### `api-admin-quality-issues`
### `api-admin-quality-issue-status`
- Gestión de issues de calidad

### `api-admin-users`
### `api-admin-user-upsert`
### `api-admin-user-role`
### `api-admin-user-delete`
### `api-admin-user-verified`
- Gestión de usuarios y roles del backoffice

### `api-admin-genres`
### `api-admin-artists`
- CRUD/admin de catálogos

### `api-admin-manual-overrides`
- Overrides manuales de presentación

### `api-admin-audit-logs`
- Lectura de auditoría

### `api-admin-source-sync`
### `api-admin-sync-runs`
- Disparo manual y monitoreo de syncs

## API interna

### `api-internal-normalization`
- Endpoint interno para normalización

## 5. Flujo de data

### Flujo de ingesta
1. `sync-global` decide qué fuentes correr
2. cada scraper obtiene eventos crudos
3. normaliza venue/location
4. resuelve identidad existente primero contra `event_sources`
5. escribe o actualiza:
   - `events`
   - `event_sources`
   - `event_occurrences`
   - `event_assets`
6. enlaza géneros en `event_genres`
7. por compatibilidad, `events` sigue sirviendo a APIs y backoffice

### Flujo de normalización musical
1. toma eventos activos sin géneros suficientes
2. infiere artistas desde `event_artists` y solo luego desde `lineup`
3. consulta aliases / cache / proveedores externos
4. escribe evidencia y runs en schema `normalization`
5. consolida clasificación en `normalization.event_classifications`
6. abre review items si hace falta

### Flujo de catálogo app
1. APIs públicas listan eventos visibles
2. hoy siguen leyendo mayormente desde `events` + relaciones
3. `event_visibility` y `app_visible_events_catalog` filtran elegibilidad editorial

### Flujo de backoffice
1. APIs admin leen y escriben eventos
2. quality y overrides operan sobre `events` y tablas de soporte
3. sync dashboards leen `ingestion.sync_runs` y `sync_run_items`

## 6. Qué es canónico y qué es legacy

### Tablas oficiales por responsabilidad
- `events`: tabla central/base del evento
- `venues`: tabla oficial del venue normalizado
- `event_artists`: tabla oficial del lineup
- `event_genres`: tabla oficial de géneros
- `event_sources`: tabla oficial de la fuente externa, precio y disponibilidad observada
- `event_occurrences`: tabla oficial de fecha/hora/location de la ocurrencia
- `event_search`: tabla oficial de búsqueda y embeddings

### Campos legacy de transición en `events`
- `events.lineup`
- `events.venue`
- `events.city`
- `events.ticket_url`
- `events.external_slug`
- `events.price_min`
- `events.price_max`
- `events.availability_status`
- `events.embedding`

En corto:
- si quieres saber cuál es el evento base, mira `events`
- si quieres saber de qué ticketera vino y cuál URL tiene, mira `event_sources`
- si quieres saber cuándo ocurre y dónde, mira `event_occurrences`
- si quieres saber qué artistas toca, mira `event_artists`
- si quieres saber qué géneros tiene, mira `event_genres`
- si quieres saber cómo se busca/recomienda, mira `event_search`

## 7. Cómo saber si el sistema está funcionando como quieres

Checklist operativo:

### Ingesta
- `sync_runs` y `sync_run_items` muestran corridas exitosas
- nuevos eventos crean/actualizan:
  - una fila en `events`
  - una fila primaria en `event_sources`
  - una fila primaria en `event_occurrences`
  - una portada en `event_assets` si existe cover

### Normalización
- `normalization.runs` crece sin exceso de `failed`
- `review_queue` solo acumula casos realmente ambiguos
- `event_classifications` tiene cobertura creciente

### Calidad
- `quality_issues` detecta problemas reales y no ruido masivo

### Producto
- APIs públicas siguen respondiendo
- backoffice puede listar/editar eventos
- filtros por fecha/fuente/ciudad siguen funcionando

## 8. Estado actual del refactor

Ya implementado:
- migración con capas canónicas nuevas
- backfill inicial
- triggers/proyecciones de compatibilidad
- normalización priorizando `event_artists`
- scrapers `sync-ticketmaster`, `sync-ticketmaster-pe` y `sync-teleticket` escribiendo con resolución por `event_sources`

Pendiente para siguientes fases:
- mover reads públicos/admin a joins/proyecciones nuevas
- dejar de depender de columnas legacy en `events`
- retirar duplicidad de datos heredada cuando el catálogo ya no la necesite
