-- Simplifies the class-cover director visibility options to just None / Name / Name and
-- Photo, dropping the "Photo only" option (a director-name-less card read as anonymous/odd).
-- Existing photo_only rows are backfilled to name_and_photo so the name doesn't silently
-- disappear for anyone already using that option.
update public.program_details
  set cover_director_visibility = 'name_and_photo'
  where cover_director_visibility = 'photo_only';

alter table public.program_details
  drop constraint if exists program_details_cover_director_visibility_check,
  add constraint program_details_cover_director_visibility_check
  check (cover_director_visibility in ('name_and_photo', 'name_only', 'none'));
