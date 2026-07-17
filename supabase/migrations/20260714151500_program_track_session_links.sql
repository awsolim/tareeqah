alter table public.program_sessions
  add column if not exists day_of_week text;

alter table public.program_sessions
  alter column session_date drop not null;

alter table public.program_sessions
  drop constraint if exists program_sessions_day_of_week_check,
  add constraint program_sessions_day_of_week_check
  check (
    day_of_week is null
    or day_of_week in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
  );

alter table public.program_sessions
  drop constraint if exists program_sessions_day_or_date_check,
  add constraint program_sessions_day_or_date_check
  check (session_date is not null or day_of_week is not null);

create table if not exists public.program_track_sessions (
  program_track_id uuid not null references public.program_tracks(id) on delete cascade,
  program_session_id uuid not null references public.program_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (program_track_id, program_session_id)
);

alter table public.program_track_sessions enable row level security;

create index if not exists program_track_sessions_session_idx
  on public.program_track_sessions(program_session_id);

drop policy if exists "public can view visible program track sessions" on public.program_track_sessions;
create policy "public can view visible program track sessions"
on public.program_track_sessions for select
using (
  exists (
    select 1
    from public.program_sessions ps
    join public.programs p on p.id = ps.program_id
    where ps.id = program_track_sessions.program_session_id
      and p.publication_status in ('published', 'hidden')
      and p.lifecycle_status not in ('cancelled', 'archived')
  )
  or exists (
    select 1
    from public.program_sessions ps
    where ps.id = program_track_sessions.program_session_id
      and public.can_manage_program(ps.program_id)
  )
);

drop policy if exists "directors and admins manage program track sessions" on public.program_track_sessions;
create policy "directors and admins manage program track sessions"
on public.program_track_sessions for all
using (
  exists (
    select 1
    from public.program_sessions ps
    where ps.id = program_track_sessions.program_session_id
      and public.can_manage_program(ps.program_id)
  )
)
with check (
  exists (
    select 1
    from public.program_sessions ps
    where ps.id = program_track_sessions.program_session_id
      and public.can_manage_program(ps.program_id)
  )
);
