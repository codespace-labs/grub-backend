create or replace function public.app_event_visibility_reason(
  event_name text,
  genre_slugs text[] default '{}'::text[]
)
returns text
language sql
immutable
as $$
  with normalized as (
    select
      lower(unaccent(coalesce(event_name, ''))) as name_norm,
      coalesce(genre_slugs, '{}'::text[]) as genres
  )
  select case
    when name_norm ~ '(^|[^a-z])(tributo|tribute|homenaje|revive|x siempre|cerati x siempre)([^a-z]|$)'
      then 'editorial_tribute'
    when name_norm ~ '(^|[^a-z])(para ninos|para niños|infantil|infantiles|ninos|niños|kids|familiar|family show|para toda la familia|titeres|títeres|marionetas|cuentacuentos|cuento infantil)([^a-z]|$)'
      then 'editorial_childrens'
    when name_norm ~ '(^|[^a-z])(cumbia|chicha|huayno|huaynos)([^a-z]|$)'
      or genres && array['cumbia', 'cumbia-andina']::text[]
      then 'editorial_cumbia'
    when name_norm ~ '(^|[^a-z])(folklore|folklorica|folklorico|folkloricos|folkloricas|andino|andinos|criollo|criollos)([^a-z]|$)'
      or genres && array['folklore']::text[]
      then 'editorial_folklore'
    when name_norm ~ '(^|[^a-z])(teatro|teatral|arlequin|obra|obra de|musical|dramaturgia|puesta en escena)([^a-z]|$)'
      then 'editorial_theater'
    when name_norm ~ '(^|[^a-z])(comedia|humor|humorista|humoristico|humoristica|humoristicos|humoristicas|impro|improv|improvisacion|stand up|standup|stand-up|comico|cómico|monologo|monólogos|monologos|monólogo|parodia|sketch|clown|payaso|payasos|rie por humor|ríe por humor)([^a-z]|$)'
      then 'editorial_comedy'
    when name_norm ~ '(^|[^a-z])(ballet|danza|coreografia|coreografias|flamenco|cisnes|lago de los)([^a-z]|$)'
      then 'editorial_dance'
    when name_norm ~ '(^|[^a-z])(fiesta en la granja|magia|ilusionismo|acrobacia|acrobatico|acrobaticos|acrobática|acrobáticas|circo)([^a-z]|$)'
      then 'editorial_family'
    else null
  end
  from normalized;
$$;
