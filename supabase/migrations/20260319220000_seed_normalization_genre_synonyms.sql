create or replace view normalization.events_without_genres as
select
  e.id,
  e.name,
  e.date,
  e.lineup,
  e.source,
  e.city
from public.events e
left join public.event_genres eg on eg.event_id = e.id
where e.is_active = true
group by e.id
having count(eg.genre_id) = 0;

create or replace view normalization.top_unmapped_signals as
select
  signal,
  count(*) as total
from (
  select
    jsonb_array_elements_text(result_payload->'unmapped_signals') as signal
  from normalization.runs
  where result_payload->'unmapped_signals' is not null
) signals
group by signal
order by total desc, signal asc;

insert into normalization.genre_synonyms (
  raw_value,
  normalized_value,
  genre_id,
  canonical_subgenre_slug,
  canonical_subgenre_name,
  source,
  confidence
)
select raw_value, normalized_value, genre_id, canonical_subgenre_slug, canonical_subgenre_name, source, confidence
from (
  values
    ('indie rock', 'indie rock', 10, 'indie-rock', 'Indie Rock', 'manual_seed', 0.95),
    ('indie pop', 'indie pop', 10, 'indie-pop', 'Indie Pop', 'manual_seed', 0.94),
    ('dream pop', 'dream pop', 10, 'dream-pop', 'Dream Pop', 'manual_seed', 0.92),
    ('shoegaze', 'shoegaze', 10, 'shoegaze', 'Shoegaze', 'manual_seed', 0.90),
    ('lo fi', 'lo fi', 10, 'lo-fi', 'Lo-Fi', 'manual_seed', 0.88),
    ('lo-fi', 'lo-fi', 10, 'lo-fi', 'Lo-Fi', 'manual_seed', 0.88),
    ('alternative rock', 'alternative rock', 6, 'alternative-rock', 'Alternative Rock', 'manual_seed', 0.95),
    ('alt rock', 'alt rock', 6, 'alternative-rock', 'Alternative Rock', 'manual_seed', 0.93),
    ('punk rock', 'punk rock', 6, 'punk-rock', 'Punk Rock', 'manual_seed', 0.90),
    ('post punk', 'post punk', 6, 'post-punk', 'Post-Punk', 'manual_seed', 0.90),
    ('post-punk', 'post-punk', 6, 'post-punk', 'Post-Punk', 'manual_seed', 0.90),
    ('classic rock', 'classic rock', 6, 'classic-rock', 'Classic Rock', 'manual_seed', 0.92),
    ('garage rock', 'garage rock', 6, 'garage-rock', 'Garage Rock', 'manual_seed', 0.89),
    ('hard rock', 'hard rock', 6, 'hard-rock', 'Hard Rock', 'manual_seed', 0.92),
    ('alternative', 'alternative', 18, 'alternative', 'Alternative', 'manual_seed', 0.92),
    ('alt', 'alt', 18, 'alternative', 'Alternative', 'manual_seed', 0.86),
    ('experimental', 'experimental', 18, 'experimental', 'Experimental', 'manual_seed', 0.84),
    ('art rock', 'art rock', 18, 'art-rock', 'Art Rock', 'manual_seed', 0.84),
    ('electronic', 'electronic', 4, 'electronic', 'Electronic', 'manual_seed', 0.95),
    ('electronic music', 'electronic music', 4, 'electronic', 'Electronic', 'manual_seed', 0.92),
    ('edm', 'edm', 4, 'edm', 'EDM', 'manual_seed', 0.92),
    ('synthwave', 'synthwave', 4, 'synthwave', 'Synthwave', 'manual_seed', 0.88),
    ('electropop', 'electropop', 4, 'electropop', 'Electropop', 'manual_seed', 0.88),
    ('ambient', 'ambient', 4, 'ambient', 'Ambient', 'manual_seed', 0.84),
    ('house music', 'house music', 2, 'house', 'House', 'manual_seed', 0.95),
    ('deep house', 'deep house', 2, 'deep-house', 'Deep House', 'manual_seed', 0.93),
    ('tech house', 'tech house', 2, 'tech-house', 'Tech House', 'manual_seed', 0.94),
    ('afro house', 'afro house', 2, 'afro-house', 'Afro House', 'manual_seed', 0.90),
    ('progressive house', 'progressive house', 2, 'progressive-house', 'Progressive House', 'manual_seed', 0.90),
    ('techno music', 'techno music', 1, 'techno', 'Techno', 'manual_seed', 0.95),
    ('melodic techno', 'melodic techno', 1, 'melodic-techno', 'Melodic Techno', 'manual_seed', 0.92),
    ('hard techno', 'hard techno', 1, 'hard-techno', 'Hard Techno', 'manual_seed', 0.92),
    ('industrial techno', 'industrial techno', 1, 'industrial-techno', 'Industrial Techno', 'manual_seed', 0.90),
    ('hip hop', 'hip hop', 7, 'hip-hop', 'Hip-Hop', 'manual_seed', 0.95),
    ('hip-hop', 'hip-hop', 7, 'hip-hop', 'Hip-Hop', 'manual_seed', 0.95),
    ('rap', 'rap', 7, 'rap', 'Rap', 'manual_seed', 0.92),
    ('boom bap', 'boom bap', 7, 'boom-bap', 'Boom Bap', 'manual_seed', 0.88),
    ('latin trap', 'latin trap', 20, 'latin-trap', 'Latin Trap', 'manual_seed', 0.95),
    ('trap latino', 'trap latino', 20, 'latin-trap', 'Latin Trap', 'manual_seed', 0.95),
    ('trap music', 'trap music', 20, 'trap', 'Trap', 'manual_seed', 0.90),
    ('latin bass', 'latin bass', 8, 'latin-bass', 'Latin Bass', 'manual_seed', 0.96),
    ('dembow', 'dembow', 8, 'dembow', 'Dembow', 'manual_seed', 0.90),
    ('reggaeton latino', 'reggaeton latino', 3, 'reggaeton', 'Reggaeton', 'manual_seed', 0.94),
    ('urbano latino', 'urbano latino', 3, 'urbano-latino', 'Urbano Latino', 'manual_seed', 0.90),
    ('r&b', 'r&b', 19, 'rnb', 'R&B', 'manual_seed', 0.95),
    ('rhythm and blues', 'rhythm and blues', 19, 'rnb', 'R&B', 'manual_seed', 0.92),
    ('neo soul', 'neo soul', 19, 'neo-soul', 'Neo Soul', 'manual_seed', 0.88),
    ('soul', 'soul', 19, 'soul', 'Soul', 'manual_seed', 0.86),
    ('latin pop', 'latin pop', 13, 'latin-pop', 'Latin Pop', 'manual_seed', 0.95),
    ('pop latino', 'pop latino', 13, 'latin-pop', 'Latin Pop', 'manual_seed', 0.95),
    ('synth pop', 'synth pop', 11, 'synth-pop', 'Synth Pop', 'manual_seed', 0.92),
    ('synthpop', 'synthpop', 11, 'synth-pop', 'Synth Pop', 'manual_seed', 0.92),
    ('dance pop', 'dance pop', 11, 'dance-pop', 'Dance Pop', 'manual_seed', 0.92),
    ('art pop', 'art pop', 11, 'art-pop', 'Art Pop', 'manual_seed', 0.86),
    ('salsa romantica', 'salsa romantica', 5, 'salsa-romantica', 'Salsa Romántica', 'manual_seed', 0.90),
    ('tropical', 'tropical', 5, 'tropical', 'Tropical', 'manual_seed', 0.84),
    ('peruvian cumbia', 'peruvian cumbia', 22, 'peruvian-cumbia', 'Peruvian Cumbia', 'manual_seed', 0.92),
    ('chicha', 'chicha', 22, 'chicha', 'Chicha', 'manual_seed', 0.95),
    ('cumbia peruana', 'cumbia peruana', 9, 'peruvian-cumbia', 'Peruvian Cumbia', 'manual_seed', 0.90),
    ('cumbia tropical', 'cumbia tropical', 9, 'tropical-cumbia', 'Cumbia Tropical', 'manual_seed', 0.88),
    ('k-pop', 'k-pop', 15, 'k-pop', 'K-Pop', 'manual_seed', 0.98),
    ('kpop', 'kpop', 15, 'k-pop', 'K-Pop', 'manual_seed', 0.98),
    ('korean pop', 'korean pop', 15, 'k-pop', 'K-Pop', 'manual_seed', 0.95),
    ('classical', 'classical', 17, 'classical', 'Classical', 'manual_seed', 0.95),
    ('classical music', 'classical music', 17, 'classical', 'Classical', 'manual_seed', 0.95),
    ('opera', 'opera', 17, 'opera', 'Opera', 'manual_seed', 0.88),
    ('orchestral', 'orchestral', 17, 'orchestral', 'Orchestral', 'manual_seed', 0.88),
    ('folk', 'folk', 21, 'folk', 'Folk', 'manual_seed', 0.90),
    ('world music', 'world music', 21, 'world-music', 'World Music', 'manual_seed', 0.84),
    ('andean music', 'andean music', 21, 'andean', 'Andean', 'manual_seed', 0.90),
    ('heavy metal', 'heavy metal', 12, 'heavy-metal', 'Heavy Metal', 'manual_seed', 0.95),
    ('black metal', 'black metal', 12, 'black-metal', 'Black Metal', 'manual_seed', 0.92),
    ('death metal', 'death metal', 12, 'death-metal', 'Death Metal', 'manual_seed', 0.92),
    ('thrash metal', 'thrash metal', 12, 'thrash-metal', 'Thrash Metal', 'manual_seed', 0.92),
    ('ballad', 'ballad', 14, 'ballad', 'Ballad', 'manual_seed', 0.88),
    ('romantic ballad', 'romantic ballad', 14, 'romantic-ballad', 'Romantic Ballad', 'manual_seed', 0.90),
    ('mariachi', 'mariachi', 14, 'mariachi', 'Mariachi', 'manual_seed', 0.84)
) seeded(raw_value, normalized_value, genre_id, canonical_subgenre_slug, canonical_subgenre_name, source, confidence)
on conflict do nothing;
