create or replace function public.lookup_program_instructor_code(invite text)
returns table (
  program_id uuid,
  title text,
  director_name text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  current_profile_id uuid := auth.uid();
  normalized_invite text := upper(trim(invite));
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
    raise exception 'Only teacher accounts can preview instructor codes';
  end if;

  return query
  select
    p.id as program_id,
    p.title,
    coalesce(director.full_name, director.email, 'Program director') as director_name
  from public.program_teachers pt
  join public.programs p on p.id = pt.program_id
  left join public.profiles director on director.id = coalesce(p.director_profile_id, p.teacher_profile_id)
  where pt.invite_code = normalized_invite
    and pt.role = 'instructor'
    and pt.teacher_profile_id is null
  limit 1;
end;
$$;

grant execute on function public.lookup_program_instructor_code(text) to authenticated;
