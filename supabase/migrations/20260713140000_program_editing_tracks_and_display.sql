alter table public.program_details
  add column if not exists learning_title text not null default 'What You Will Learn',
  add column if not exists instructor_display_name text,
  add column if not exists instructor_credentials text,
  add column if not exists instructor_contact_phone text;

create table if not exists public.program_tracks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  name text not null,
  description text,
  schedule jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, sort_order)
);

create index if not exists program_tracks_program_idx
  on public.program_tracks(program_id, sort_order);

alter table public.program_tracks enable row level security;

drop policy if exists "public can view active program tracks" on public.program_tracks;
create policy "public can view active program tracks"
on public.program_tracks for select
using (
  is_active = true
  and exists (
    select 1
    from public.programs p
    where p.id = program_tracks.program_id
      and p.is_active = true
  )
);

drop policy if exists "teachers and admins manage program tracks" on public.program_tracks;
create policy "teachers and admins manage program tracks"
on public.program_tracks for all
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

alter table public.enrollment_requests
  add column if not exists program_track_id uuid references public.program_tracks(id) on delete set null;

alter table public.enrollments
  add column if not exists program_track_id uuid references public.program_tracks(id) on delete set null;

alter table public.program_subscriptions
  add column if not exists program_track_id uuid references public.program_tracks(id) on delete set null;
