create extension if not exists pgcrypto;

alter table public.enrollment_requests
  add column if not exists student_dismissed_at timestamptz;

create unique index if not exists enrollments_program_student_unique
  on public.enrollments(program_id, student_profile_id);

create table if not exists public.program_announcement_receipts (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.program_announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (announcement_id, profile_id)
);

create index if not exists program_announcement_receipts_profile_idx
  on public.program_announcement_receipts(profile_id, dismissed_at, read_at);

alter table public.program_announcements enable row level security;
alter table public.program_announcement_receipts enable row level security;
alter table public.enrollments enable row level security;

drop policy if exists "enrolled students and teachers view announcements" on public.program_announcements;
create policy "enrolled students and teachers view announcements"
on public.program_announcements for select
using (
  exists (
    select 1
    from public.enrollments e
    where e.program_id = program_announcements.program_id
      and e.student_profile_id = auth.uid()
  )
  or public.is_program_teacher(program_id)
);

drop policy if exists "teachers create announcements for assigned programs" on public.program_announcements;
create policy "teachers create announcements for assigned programs"
on public.program_announcements for insert
with check (
  author_profile_id = auth.uid()
  and public.is_program_teacher(program_id)
);

drop policy if exists "announcement receipts visible to owner" on public.program_announcement_receipts;
create policy "announcement receipts visible to owner"
on public.program_announcement_receipts for select
using (profile_id = auth.uid());

drop policy if exists "students manage own announcement receipts" on public.program_announcement_receipts;
create policy "students manage own announcement receipts"
on public.program_announcement_receipts for all
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

drop policy if exists "students view own enrollments and teachers view assigned enrollments" on public.enrollments;
create policy "students view own enrollments and teachers view assigned enrollments"
on public.enrollments for select
using (
  student_profile_id = auth.uid()
  or public.is_program_teacher(program_id)
);

drop policy if exists "teachers and admins create enrollments" on public.enrollments;
create policy "teachers and admins create enrollments"
on public.enrollments for insert
with check (public.can_manage_program(program_id));

drop policy if exists "teachers and admins delete enrollments" on public.enrollments;
create policy "teachers and admins delete enrollments"
on public.enrollments for delete
using (public.can_manage_program(program_id));

drop policy if exists "students cancel and dismiss own enrollment requests" on public.enrollment_requests;
create policy "students cancel and dismiss own enrollment requests"
on public.enrollment_requests for update
using (student_profile_id = auth.uid())
with check (student_profile_id = auth.uid());

drop policy if exists "teachers and admins review enrollment requests" on public.enrollment_requests;
create policy "teachers and admins review enrollment requests"
on public.enrollment_requests for update
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

drop policy if exists "teachers and admins create returned enrollment notices" on public.enrollment_requests;
create policy "teachers and admins create returned enrollment notices"
on public.enrollment_requests for insert
with check (
  status in ('cancelled', 'rejected')
  and public.can_manage_program(program_id)
);

drop policy if exists "teachers can view request and enrolled student profiles" on public.profiles;
create policy "teachers can view request and enrolled student profiles"
on public.profiles for select
using (
  exists (
    select 1
    from public.enrollment_requests er
    where er.student_profile_id = profiles.id
      and public.can_manage_program(er.program_id)
  )
  or exists (
    select 1
    from public.enrollments e
    where e.student_profile_id = profiles.id
      and public.can_manage_program(e.program_id)
  )
);
