alter table public.program_teachers
  add column if not exists can_manage_finances boolean not null default false;

create table if not exists public.program_finance_audit_events (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  student_profile_id uuid references public.profiles(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.program_finance_audit_events enable row level security;

drop policy if exists "program finance audit visible to admins and finance directors" on public.program_finance_audit_events;
create policy "program finance audit visible to admins and finance directors"
on public.program_finance_audit_events for select
using (
  exists (
    select 1
    from public.programs p
    where p.id = program_finance_audit_events.program_id
      and public.has_mosque_role(p.mosque_id, array['admin'])
  )
  or exists (
    select 1
    from public.program_teachers pt
    where pt.program_id = program_finance_audit_events.program_id
      and pt.teacher_profile_id = auth.uid()
      and pt.role = 'director'
      and pt.can_manage_finances = true
  )
);

drop policy if exists "program finance audit insertable by admins and finance directors" on public.program_finance_audit_events;
create policy "program finance audit insertable by admins and finance directors"
on public.program_finance_audit_events for insert
with check (
  exists (
    select 1
    from public.programs p
    where p.id = program_finance_audit_events.program_id
      and public.has_mosque_role(p.mosque_id, array['admin'])
  )
  or exists (
    select 1
    from public.program_teachers pt
    where pt.program_id = program_finance_audit_events.program_id
      and pt.teacher_profile_id = auth.uid()
      and pt.role = 'director'
      and pt.can_manage_finances = true
  )
);

create index if not exists program_finance_audit_program_created_idx
  on public.program_finance_audit_events(program_id, created_at desc);
