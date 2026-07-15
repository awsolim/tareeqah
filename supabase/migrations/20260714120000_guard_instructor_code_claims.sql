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
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
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
    raise exception 'Teacher approval is required before joining a class';
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
    and not exists (
      select 1
      from public.programs p
      where p.id = pt.program_id
        and (
          p.director_profile_id = current_profile_id
          or p.teacher_profile_id = current_profile_id
        )
    )
    and not exists (
      select 1
      from public.program_teachers existing
      where existing.program_id = pt.program_id
        and existing.teacher_profile_id = current_profile_id
        and existing.role in ('director', 'instructor')
    );

  if not found then
    raise exception 'Invalid or already used instructor code';
  end if;

  return target_program_id;
end;
$$;

grant execute on function public.claim_program_instructor_code(text) to authenticated;
