-- Ampliar el CHECK constraint de events.source para incluir los nuevos scrapers.
-- Fuentes anteriores: solo 'teleticket' (y posiblemente 'ticketmaster').
-- Fuentes nuevas: joinnus, vastion, tikpe, passline.

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_source_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_source_check
  CHECK (source IN (
    'ticketmaster',
    'teleticket',
    'joinnus',
    'vastion',
    'tikpe',
    'passline'
  ));

-- Limpiar la fila de prueba insertada durante el diagnóstico
DELETE FROM public.events WHERE ticket_url = 'https://test.com/test-vastion-probe';
