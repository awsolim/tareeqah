create extension if not exists pgcrypto;

create table if not exists public.program_session_cancellations (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  session_date date not null,
  start_time text not null,
  end_time text,
  cancelled_by uuid references public.profiles(id) on delete set null,
  announcement_id uuid references public.program_announcements(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, session_date, start_time)
);

create index if not exists program_session_cancellations_lookup_idx
  on public.program_session_cancellations(program_id, session_date);

alter table public.program_session_cancellations enable row level security;

drop policy if exists "enrolled students and teachers view cancelled sessions" on public.program_session_cancellations;
create policy "enrolled students and teachers view cancelled sessions"
on public.program_session_cancellations for select
using (
  exists (
    select 1
    from public.enrollments e
    where e.program_id = program_session_cancellations.program_id
      and e.student_profile_id = auth.uid()
  )
  or public.is_program_teacher(program_id)
);

drop policy if exists "teachers cancel assigned program sessions" on public.program_session_cancellations;
create policy "teachers cancel assigned program sessions"
on public.program_session_cancellations for insert
with check (
  cancelled_by = auth.uid()
  and public.is_program_teacher(program_id)
);

drop policy if exists "teachers update assigned program cancellations" on public.program_session_cancellations;
create policy "teachers update assigned program cancellations"
on public.program_session_cancellations for update
using (public.is_program_teacher(program_id))
with check (public.is_program_teacher(program_id));
