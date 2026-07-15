drop policy if exists "program staff profiles visible to assigned staff and mosque admins" on public.profiles;
create policy "program staff profiles visible to assigned staff and mosque admins"
on public.profiles for select
using (
  exists (
    select 1
    from public.program_teachers pt
    join public.programs p on p.id = pt.program_id
    where pt.teacher_profile_id = profiles.id
      and (
        public.has_mosque_role(p.mosque_id, array['admin'])
        or public.is_program_teacher(pt.program_id)
      )
  )
);
