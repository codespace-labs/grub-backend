-- Desactiva eventos fuera del perfil editorial de Grub:
-- - tributos / homenajes / revive / x siempre
-- - infantiles / para ninos
-- - cumbia / chicha / huayno / folklore / andino / criollo
-- - eventos sin cover

with blocked_by_genre as (
  select distinct eg.event_id
  from public.event_genres eg
  join public.genres g on g.id = eg.genre_id
  where g.slug in ('cumbia', 'cumbia-andina', 'folklore')
),
blocked_by_title as (
  select e.id
  from public.events e
  where lower(unaccent(coalesce(e.name, ''))) ~
    '(^|[^a-z])(tributo|tribute|homenaje|revive|x siempre|cerati x siempre|cumbia|chicha|huayno|huaynos|folklore|folklorica|folklorico|folkloricos|folkloricas|andino|andinos|criollo|criollos|infantil|infantiles|ninos|niños|kids)([^a-z]|$)'
),
blocked as (
  select id from blocked_by_title
  union
  select event_id as id from blocked_by_genre
)
update public.events e
set is_active = false
where e.id in (select id from blocked);
