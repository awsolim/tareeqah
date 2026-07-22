-- Lets a director choose what shows on the class cover image/card (browse lists, enrolled
-- list) independently of the always-full "Program Director" info box on the public detail
-- page, which is unaffected by this setting.
alter table public.program_details
  add column if not exists cover_director_visibility text not null default 'name_and_photo';

alter table public.program_details
  drop constraint if exists program_details_cover_director_visibility_check,
  add constraint program_details_cover_director_visibility_check
  check (cover_director_visibility in ('name_and_photo', 'name_only', 'photo_only', 'none'));
