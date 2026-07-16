alter table public.programs
  add column if not exists internal_name text,
  add column if not exists summary text,
  add column if not exists category text,
  add column if not exists program_type text not null default 'recurring',
  add column if not exists publication_status text not null default 'published',
  add column if not exists application_status text not null default 'accepting',
  add column if not exists lifecycle_status text not null default 'upcoming',
  add column if not exists application_mode text not null default 'application_required',
  add column if not exists accepting_applications boolean not null default true,
  add column if not exists application_open_at timestamptz,
  add column if not exists application_close_at timestamptz,
  add column if not exists waitlist_enabled boolean not null default true,
  add column if not exists capacity_behavior text not null default 'manual_review',
  add column if not exists default_capacity integer,
  add column if not exists duration_type text not null default 'ongoing',
  add column if not exists start_now boolean not null default false,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists duration_months integer,
  add column if not exists is_ongoing boolean not null default false,
  add column if not exists schedule_pattern text not null default 'weekly',
  add column if not exists registration_deadline_at timestamptz,
  add column if not exists location text,
  add column if not exists room text,
  add column if not exists payment_kind text not null default 'free',
  add column if not exists billing_start_behavior text not null default 'on_payment',
  add column if not exists billing_end_behavior text not null default 'fixed_months',
  add column if not exists billing_duration_months integer not null default 10,
  add column if not exists allow_custom_prices boolean not null default true,
  add column if not exists allow_waived_payments boolean not null default true,
  add column if not exists manual_payment_note text,
  add column if not exists financial_assistance_note text,
  add column if not exists receipt_note text,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

alter table public.programs
  drop constraint if exists programs_program_type_check,
  add constraint programs_program_type_check
  check (program_type in ('recurring', 'event'));

alter table public.programs
  drop constraint if exists programs_publication_status_check,
  add constraint programs_publication_status_check
  check (publication_status in ('draft', 'published', 'hidden', 'archived'));

alter table public.programs
  drop constraint if exists programs_application_status_check,
  add constraint programs_application_status_check
  check (application_status in ('accepting', 'not_accepting', 'waitlist_only', 'closed', 'invite_only'));

alter table public.programs
  drop constraint if exists programs_lifecycle_status_check,
  add constraint programs_lifecycle_status_check
  check (lifecycle_status in ('upcoming', 'active', 'completed', 'cancelled', 'archived'));

alter table public.programs
  drop constraint if exists programs_application_mode_check,
  add constraint programs_application_mode_check
  check (application_mode in ('application_required', 'open_enrollment', 'invite_only', 'hidden_private'));

alter table public.programs
  drop constraint if exists programs_capacity_behavior_check,
  add constraint programs_capacity_behavior_check
  check (capacity_behavior in ('manual_review', 'close_when_full', 'allow_waitlist'));

alter table public.programs
  drop constraint if exists programs_duration_type_check,
  add constraint programs_duration_type_check
  check (duration_type in ('ongoing', 'fixed_months'));

alter table public.programs
  drop constraint if exists programs_schedule_pattern_check,
  add constraint programs_schedule_pattern_check
  check (schedule_pattern in ('weekly', 'custom_dates'));

alter table public.programs
  drop constraint if exists programs_payment_kind_check,
  add constraint programs_payment_kind_check
  check (payment_kind in ('free', 'tareeqah', 'manual'));

alter table public.programs
  drop constraint if exists programs_billing_start_behavior_check,
  add constraint programs_billing_start_behavior_check
  check (billing_start_behavior in ('on_payment', 'program_start'));

alter table public.programs
  drop constraint if exists programs_billing_end_behavior_check,
  add constraint programs_billing_end_behavior_check
  check (billing_end_behavior in ('manual_cancel', 'program_end', 'fixed_months'));

alter table public.program_tracks
  add column if not exists gender_override text,
  add column if not exists age_min integer,
  add column if not exists age_max integer,
  add column if not exists location text,
  add column if not exists room text,
  add column if not exists capacity integer,
  add column if not exists pricing_override_enabled boolean not null default false,
  add column if not exists price_monthly_cents integer,
  add column if not exists price_annual_cents integer;

alter table public.program_details
  add column if not exists requirements_text text,
  add column if not exists what_to_bring_text text,
  add column if not exists policies_text text,
  add column if not exists topics_intro text;

create table if not exists public.program_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  program_track_id uuid references public.program_tracks(id) on delete cascade,
  session_date date not null,
  start_time time not null,
  end_time time,
  title text,
  location text,
  room text,
  notes text,
  capacity integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.program_sessions enable row level security;

create index if not exists program_sessions_program_date_idx
  on public.program_sessions(program_id, session_date, start_time);

create index if not exists program_sessions_track_date_idx
  on public.program_sessions(program_track_id, session_date, start_time);

drop policy if exists "public can view visible program sessions" on public.program_sessions;
create policy "public can view visible program sessions"
on public.program_sessions for select
using (
  exists (
    select 1
    from public.programs p
    where p.id = program_sessions.program_id
      and p.publication_status in ('published', 'hidden')
      and p.lifecycle_status not in ('cancelled', 'archived')
  )
  or public.can_manage_program(program_id)
);

drop policy if exists "directors and admins manage program sessions" on public.program_sessions;
create policy "directors and admins manage program sessions"
on public.program_sessions for all
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

create index if not exists programs_public_listing_idx
  on public.programs(mosque_id, publication_status, lifecycle_status, application_status);
