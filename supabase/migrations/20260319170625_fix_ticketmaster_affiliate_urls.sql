-- Los eventos importados por el viejo sync-ticketmaster (API Discovery v2) tienen
-- ticket_url en formato afiliado:
--   https://ticketmaster.evyy.net/c/.../27028?u=https%3A%2F%2Fwww.ticketmaster.pe%2Fevent%2FSLUG&utm_medium=affiliate
--
-- El nuevo sync-ticketmaster-pe extrae la URL limpia directa:
--   https://www.ticketmaster.pe/event/SLUG
--
-- El unique constraint en external_slug impide insertar nuevas filas con el mismo slug.
-- Esta migración convierte las URLs de afiliado a URLs limpias para que el upsert funcione.

UPDATE public.events
SET ticket_url = 'https://www.ticketmaster.pe/event/' ||
  regexp_replace(
    regexp_replace(
      ticket_url,
      '.*u=https%3A%2F%2Fwww\.ticketmaster\.pe%2Fevent%2F',
      ''
    ),
    '&.*',
    ''
  )
WHERE source = 'ticketmaster'
  AND ticket_url LIKE '%ticketmaster.evyy.net%';
