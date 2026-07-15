create or replace function public.resign_program_instructor(target_program_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := auth.uid();
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.program_teachers pt
  where pt.program_id = target_program_id
    and pt.teacher_profile_id = current_profile_id
    and pt.role = 'instructor';

  if not found then
    raise exception 'Instructor assignment not found';
  end if;
end;
$$;

grant execute on function public.resign_program_instructor(uuid) to authenticated;
