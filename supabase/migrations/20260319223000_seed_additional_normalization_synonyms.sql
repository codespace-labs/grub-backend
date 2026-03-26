insert into normalization.genre_synonyms (
  raw_value,
  normalized_value,
  genre_id,
  canonical_subgenre_slug,
  canonical_subgenre_name,
  source,
  confidence
)
values
  ('pop rock', 'pop rock', 6, 'pop-rock', 'Pop Rock', 'manual_seed', 0.90),
  ('rock and indie', 'rock and indie', 10, 'indie-rock', 'Indie Rock', 'manual_seed', 0.88)
on conflict do nothing;
