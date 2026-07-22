-- program_tracks.age_min/age_max/gender_override already existed but were always written null
-- (no UI ever set them). This adds the one missing piece — a free-text, non-validated note a
-- director can attach to a track's eligibility override, shown on the public page but not
-- enforced like age/gender are.
alter table public.program_tracks
  add column if not exists eligibility_comment text;
