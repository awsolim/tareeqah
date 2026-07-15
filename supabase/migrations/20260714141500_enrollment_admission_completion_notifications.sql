alter table public.enrollment_requests
  add column if not exists admission_completed_at timestamptz;

create index if not exists enrollment_requests_admission_completed_idx
  on public.enrollment_requests(program_id, admission_completed_at desc)
  where admission_completed_at is not null;
