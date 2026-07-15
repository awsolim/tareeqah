alter table public.programs
  add column if not exists track_selection_mode text not null default 'exact',
  add column if not exists track_selection_count integer not null default 1;

alter table public.programs
  drop constraint if exists programs_track_selection_mode_check;

alter table public.programs
  add constraint programs_track_selection_mode_check
  check (track_selection_mode in ('exact', 'minimum', 'maximum'));

alter table public.programs
  drop constraint if exists programs_track_selection_count_check;

alter table public.programs
  add constraint programs_track_selection_count_check
  check (track_selection_count >= 1);

create table if not exists public.enrollment_request_tracks (
  enrollment_request_id uuid not null references public.enrollment_requests(id) on delete cascade,
  program_track_id uuid not null references public.program_tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (enrollment_request_id, program_track_id)
);

create table if not exists public.enrollment_tracks (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  program_track_id uuid not null references public.program_tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (enrollment_id, program_track_id)
);

create table if not exists public.program_subscription_tracks (
  program_subscription_id uuid not null references public.program_subscriptions(id) on delete cascade,
  program_track_id uuid not null references public.program_tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (program_subscription_id, program_track_id)
);

insert into public.enrollment_request_tracks (enrollment_request_id, program_track_id)
select id, program_track_id
from public.enrollment_requests
where program_track_id is not null
on conflict do nothing;

insert into public.enrollment_tracks (enrollment_id, program_track_id)
select id, program_track_id
from public.enrollments
where program_track_id is not null
on conflict do nothing;

insert into public.program_subscription_tracks (program_subscription_id, program_track_id)
select id, program_track_id
from public.program_subscriptions
where program_track_id is not null
on conflict do nothing;

alter table public.enrollment_request_tracks enable row level security;
alter table public.enrollment_tracks enable row level security;
alter table public.program_subscription_tracks enable row level security;

drop policy if exists "enrollment request tracks visible with request" on public.enrollment_request_tracks;
create policy "enrollment request tracks visible with request"
on public.enrollment_request_tracks for select
using (
  exists (
    select 1
    from public.enrollment_requests er
    where er.id = enrollment_request_tracks.enrollment_request_id
      and (
        er.student_profile_id = auth.uid()
        or er.parent_profile_id = auth.uid()
        or public.can_manage_program(er.program_id)
      )
  )
);

drop policy if exists "students parents and staff manage enrollment request tracks" on public.enrollment_request_tracks;
create policy "students parents and staff manage enrollment request tracks"
on public.enrollment_request_tracks for all
using (
  exists (
    select 1
    from public.enrollment_requests er
    where er.id = enrollment_request_tracks.enrollment_request_id
      and (
        er.student_profile_id = auth.uid()
        or er.parent_profile_id = auth.uid()
        or public.can_manage_program(er.program_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.enrollment_requests er
    join public.program_tracks pt on pt.id = enrollment_request_tracks.program_track_id
    where er.id = enrollment_request_tracks.enrollment_request_id
      and pt.program_id = er.program_id
      and (
        er.student_profile_id = auth.uid()
        or er.parent_profile_id = auth.uid()
        or public.can_manage_program(er.program_id)
      )
  )
);

drop policy if exists "enrollment tracks visible to enrolled users and staff" on public.enrollment_tracks;
create policy "enrollment tracks visible to enrolled users and staff"
on public.enrollment_tracks for select
using (
  exists (
    select 1
    from public.enrollments e
    where e.id = enrollment_tracks.enrollment_id
      and (
        e.student_profile_id = auth.uid()
        or public.can_manage_program(e.program_id)
      )
  )
);

drop policy if exists "staff manage enrollment tracks" on public.enrollment_tracks;
create policy "staff manage enrollment tracks"
on public.enrollment_tracks for all
using (
  exists (
    select 1
    from public.enrollments e
    where e.id = enrollment_tracks.enrollment_id
      and public.can_manage_program(e.program_id)
  )
)
with check (
  exists (
    select 1
    from public.enrollments e
    join public.program_tracks pt on pt.id = enrollment_tracks.program_track_id
    where e.id = enrollment_tracks.enrollment_id
      and pt.program_id = e.program_id
      and public.can_manage_program(e.program_id)
  )
);

drop policy if exists "subscription tracks visible to subscription users and staff" on public.program_subscription_tracks;
create policy "subscription tracks visible to subscription users and staff"
on public.program_subscription_tracks for select
using (
  exists (
    select 1
    from public.program_subscriptions ps
    where ps.id = program_subscription_tracks.program_subscription_id
      and (
        ps.student_profile_id = auth.uid()
        or ps.parent_profile_id = auth.uid()
        or public.can_manage_program(ps.program_id)
      )
  )
);
