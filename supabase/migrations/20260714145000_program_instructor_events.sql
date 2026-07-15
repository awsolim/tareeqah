create table if not exists public.program_instructor_events (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  assignment_id uuid,
  teacher_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('joined', 'resigned')),
  created_at timestamptz not null default now()
);

alter table public.program_instructor_events enable row level security;

create index if not exists program_instructor_events_program_created_idx
  on public.program_instructor_events(program_id, created_at desc);

drop policy if exists "program instructor events visible to directors and admins" on public.program_instructor_events;
create policy "program instructor events visible to directors and admins"
on public.program_instructor_events for select
using (
  public.is_program_director(program_id)
  or exists (
    select 1
    from public.programs p
    where p.id = program_instructor_events.program_id
      and public.has_mosque_role(p.mosque_id, array['admin'])
  )
);

drop function if exists public.claim_program_instructor_code(text);
create or replace function public.claim_program_instructor_code(invite text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := auth.uid();
  normalized_invite text := upper(trim(invite));
  target_program_id uuid;
  target_mosque_id uuid;
  target_assignment_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = current_profile_id
      and p.account_type = 'teacher'
  ) then
    raise exception 'Only teacher accounts can use instructor codes';
  end if;

  select pt.program_id, p.mosque_id
  into target_program_id, target_mosque_id
  from public.program_teachers pt
  join public.programs p on p.id = pt.program_id
  where pt.invite_code = normalized_invite
    and pt.role = 'instructor'
    and pt.teacher_profile_id is null
  limit 1;

  if target_program_id is null then
    raise exception 'Invalid or already used instructor code';
  end if;

  if not public.has_verified_teacher_membership(target_mosque_id, current_profile_id) then
    raise exception 'A teacher account for this masjid is required before joining a class';
  end if;

  if exists (
    select 1
    from public.programs p
    where p.id = target_program_id
      and (
        p.director_profile_id = current_profile_id
        or p.teacher_profile_id = current_profile_id
      )
  )
  or exists (
    select 1
    from public.program_teachers existing
    where existing.program_id = target_program_id
      and existing.teacher_profile_id = current_profile_id
      and existing.role in ('director', 'instructor')
  ) then
    raise exception 'You are already a teacher for this class';
  end if;

  update public.program_teachers pt
  set teacher_profile_id = current_profile_id
  where pt.program_id = target_program_id
    and pt.role = 'instructor'
    and pt.invite_code = normalized_invite
    and pt.teacher_profile_id is null
  returning pt.id into target_assignment_id;

  if target_assignment_id is null then
    raise exception 'Invalid or already used instructor code';
  end if;

  insert into public.program_instructor_events (program_id, assignment_id, teacher_profile_id, event_type)
  values (target_program_id, target_assignment_id, current_profile_id, 'joined');

  return target_program_id;
end;
$$;

create or replace function public.resign_program_instructor(target_program_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := auth.uid();
  target_assignment_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  select pt.id
  into target_assignment_id
  from public.program_teachers pt
  where pt.program_id = target_program_id
    and pt.teacher_profile_id = current_profile_id
    and pt.role = 'instructor'
  limit 1;

  if target_assignment_id is null then
    raise exception 'Instructor assignment not found';
  end if;

  insert into public.program_instructor_events (program_id, assignment_id, teacher_profile_id, event_type)
  values (target_program_id, target_assignment_id, current_profile_id, 'resigned');

  delete from public.program_teachers pt
  where pt.id = target_assignment_id;
end;
$$;

grant execute on function public.claim_program_instructor_code(text) to authenticated;
grant execute on function public.resign_program_instructor(uuid) to authenticated;
