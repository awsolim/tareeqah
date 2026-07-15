alter table public.program_announcements
  add column if not exists target_program_track_ids uuid[] not null default '{}';

create index if not exists program_announcements_target_tracks_idx
  on public.program_announcements using gin (target_program_track_ids);
