-- Permitir fuentes usadas por backoffice y aliases históricos.
-- Esto evita que la creación manual o la edición de eventos heredados falle
-- por el CHECK de public.events.source.

alter table public.events
  drop constraint if exists events_source_check;

alter table public.events
  add constraint events_source_check
  check (
    source in (
      'manual',
      'ticketmaster',
      'ticketmaster-pe',
      'teleticket',
      'joinnus',
      'vastion',
      'tikpe',
      'passline'
    )
  );
