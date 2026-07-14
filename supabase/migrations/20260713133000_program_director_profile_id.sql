alter table public.programs
  add column if not exists director_profile_id uuid references public.profiles(id) on delete set null;

update public.programs
set director_profile_id = teacher_profile_id
where director_profile_id is null
  and teacher_profile_id is not null;

insert into public.program_teachers (program_id, teacher_profile_id, role)
select id, director_profile_id, 'director'
from public.programs
where director_profile_id is not null
on conflict (program_id, teacher_profile_id) do update
set role = 'director';

create or replace function public.is_program_teacher(
  check_program_id uuid,
  check_profile_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_platform_admin(check_profile_id)
  or exists (
    select 1
    from public.program_teachers pt
    join public.programs p on p.id = pt.program_id
    where pt.program_id = check_program_id
      and pt.teacher_profile_id = check_profile_id
      and public.has_verified_teacher_membership(p.mosque_id, check_profile_id)
  )
  or exists (
    select 1
    from public.programs p
    where p.id = check_program_id
      and p.director_profile_id = check_profile_id
      and public.has_verified_teacher_membership(p.mosque_id, check_profile_id)
  );
$$;

create or replace function public.is_program_director(
  check_program_id uuid,
  check_profile_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_platform_admin(check_profile_id)
  or exists (
    select 1
    from public.program_teachers pt
    join public.programs p on p.id = pt.program_id
    where pt.program_id = check_program_id
      and pt.teacher_profile_id = check_profile_id
      and pt.role = 'director'
      and public.has_verified_teacher_membership(p.mosque_id, check_profile_id)
  )
  or exists (
    select 1
    from public.programs p
    where p.id = check_program_id
      and p.director_profile_id = check_profile_id
      and public.has_verified_teacher_membership(p.mosque_id, check_profile_id)
  );
$$;

drop policy if exists "public can view active program teacher display profiles" on public.profiles;
create policy "public can view active program director display profiles"
on public.profiles for select
using (
  exists (
    select 1
    from public.programs p
    where p.director_profile_id = profiles.id
      and p.is_active = true
  )
);

