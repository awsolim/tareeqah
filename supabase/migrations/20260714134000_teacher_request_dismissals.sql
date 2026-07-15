alter table public.enrollment_requests
  add column if not exists teacher_dismissed_at timestamptz;
