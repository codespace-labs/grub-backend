-- Clean up historical event genres that were over-propagated from
-- MusicBrainz artist tags before the refined backfill rules.

with corrected(event_id, slug) as (
  values
    ('2e49c672-3e07-49d6-8f99-63513b62dc12'::uuid, 'balada'),
    ('6ae66d7a-c4d5-4a48-a405-47da407fcd62'::uuid, 'balada'),
    ('bc48160a-2989-4b42-b3ff-e8b2e5a83e21'::uuid, 'reggaeton'),
    ('bc48160a-2989-4b42-b3ff-e8b2e5a83e21'::uuid, 'trap'),
    ('7748a40a-f63e-4f1e-a9b0-6bca50a334bc'::uuid, 'indie'),
    ('47dd25f0-bcb7-4a26-9e19-bbe9d405b98f'::uuid, 'balada'),
    ('47dd25f0-bcb7-4a26-9e19-bbe9d405b98f'::uuid, 'pop'),
    ('2fdb2a83-e886-4385-807d-bc476a028b2a'::uuid, 'pop'),
    ('2fdb2a83-e886-4385-807d-bc476a028b2a'::uuid, 'pop-latino'),
    ('f0b8a710-e8d0-499b-944e-c69cc8abd0fe'::uuid, 'electronica'),
    ('f0b8a710-e8d0-499b-944e-c69cc8abd0fe'::uuid, 'rock'),
    ('46535c06-9f53-4ca4-abe4-c0fdab635fda'::uuid, 'balada'),
    ('46535c06-9f53-4ca4-abe4-c0fdab635fda'::uuid, 'pop-latino'),
    ('16dc4ef7-a9a4-4215-9cdb-966c97c2594e'::uuid, 'rock'),
    ('407a1ff8-2047-4927-b433-b2e8c96ca734'::uuid, 'indie'),
    ('407a1ff8-2047-4927-b433-b2e8c96ca734'::uuid, 'rock'),
    ('11c355e4-23de-4ee4-9432-cd1b26a09aa4'::uuid, 'alternativo'),
    ('11c355e4-23de-4ee4-9432-cd1b26a09aa4'::uuid, 'indie'),
    ('11c355e4-23de-4ee4-9432-cd1b26a09aa4'::uuid, 'rock'),
    ('ecfe1ced-21b4-45fa-b7fd-8f607e500c60'::uuid, 'pop'),
    ('ecfe1ced-21b4-45fa-b7fd-8f607e500c60'::uuid, 'rock'),
    ('5d50382f-5517-4596-a547-25123bb06a61'::uuid, 'reggaeton'),
    ('5d50382f-5517-4596-a547-25123bb06a61'::uuid, 'trap'),
    ('f4aa168e-b364-4e0a-a26f-0a105bd34e3e'::uuid, 'pop'),
    ('f4aa168e-b364-4e0a-a26f-0a105bd34e3e'::uuid, 'pop-latino')
),
affected as (
  select distinct event_id from corrected
),
deleted as (
  delete from public.event_genres eg
  using affected a
  where eg.event_id = a.event_id
  returning eg.event_id
)
insert into public.event_genres (event_id, genre_id)
select
  c.event_id,
  g.id
from corrected c
join public.genres g
  on g.slug = c.slug
on conflict do nothing;
