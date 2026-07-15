drop policy if exists "mosque admins view mosque member profiles" on public.profiles;
create policy "mosque admins view mosque member profiles"
on public.profiles for select
using (
  exists (
    select 1
    from public.mosque_memberships mm
    where mm.profile_id = profiles.id
      and public.has_mosque_role(mm.mosque_id, array['admin'])
  )
  or exists (
    select 1
    from public.program_teachers pt
    join public.programs p on p.id = pt.program_id
    where pt.teacher_profile_id = profiles.id
      and public.has_mosque_role(p.mosque_id, array['admin'])
  )
);
