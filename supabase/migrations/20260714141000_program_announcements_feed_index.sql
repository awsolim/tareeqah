create index if not exists program_announcements_program_created_at_idx
  on public.program_announcements (program_id, created_at desc);
