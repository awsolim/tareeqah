drop policy if exists "platform roles are visible to self and platform admins" on public.platform_roles;
drop policy if exists "platform admins manage platform roles" on public.platform_roles;
drop function if exists public.is_platform_admin(uuid);
drop table if exists public.platform_roles;

alter table public.mosque_memberships
  drop constraint if exists mosque_memberships_role_check;

alter table public.mosque_memberships
  add constraint mosque_memberships_role_check
  check (role in ('student', 'parent', 'teacher', 'admin'));

create or replace function public.has_mosque_role(
  check_mosque_id uuid,
  allowed_roles text[],
  check_profile_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.mosque_memberships mm
    where mm.mosque_id = check_mosque_id
      and mm.profile_id = check_profile_id
      and mm.status = 'active'
      and mm.role = any(allowed_roles)
  );
$$;

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
  select exists (
    select 1
    from public.program_teachers pt
    where pt.program_id = check_program_id
      and pt.teacher_profile_id = check_profile_id
  )
  or exists (
    select 1
    from public.programs p
    where p.id = check_program_id
      and p.teacher_profile_id = check_profile_id
  );
$$;

create or replace function public.can_manage_program(
  check_program_id uuid,
  check_profile_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.programs p
    where p.id = check_program_id
      and public.has_mosque_role(p.mosque_id, array['admin'], check_profile_id)
  )
  or public.is_program_teacher(check_program_id, check_profile_id);
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_account_type text := nullif(new.raw_user_meta_data->>'account_type', '');
  signup_mosque_slug text := nullif(new.raw_user_meta_data->>'mosque_slug', '');
  signup_mosque_id uuid;
begin
  insert into public.profiles (id, full_name, email, phone_number, account_type, age, gender)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    nullif(new.raw_user_meta_data->>'phone', ''),
    signup_account_type,
    case when signup_account_type = 'student' then nullif(new.raw_user_meta_data->>'age', '') else null end,
    case when signup_account_type = 'student' then nullif(new.raw_user_meta_data->>'gender', '') else null end
  )
  on conflict (id) do update
  set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    email = coalesce(excluded.email, public.profiles.email),
    phone_number = coalesce(excluded.phone_number, public.profiles.phone_number),
    account_type = coalesce(excluded.account_type, public.profiles.account_type),
    age = coalesce(excluded.age, public.profiles.age),
    gender = coalesce(excluded.gender, public.profiles.gender),
    updated_at = now();

  if signup_mosque_slug is not null and signup_account_type in ('student', 'parent') then
    select id
    into signup_mosque_id
    from public.mosques
    where slug = signup_mosque_slug
    limit 1;

    if signup_mosque_id is not null then
      update public.mosque_memberships
      set status = 'active',
          updated_at = now()
      where mosque_id = signup_mosque_id
        and profile_id = new.id
        and role = signup_account_type;

      if not found then
        insert into public.mosque_memberships (mosque_id, profile_id, role, status)
        values (signup_mosque_id, new.id, signup_account_type, 'active');
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop policy if exists "memberships visible to member and mosque admins" on public.mosque_memberships;
create policy "memberships visible to member and mosque admins"
on public.mosque_memberships for select
using (
  profile_id = auth.uid()
  or public.has_mosque_role(mosque_id, array['admin', 'teacher'])
);

drop policy if exists "mosque admins manage memberships" on public.mosque_memberships;
create policy "mosque admins manage memberships"
on public.mosque_memberships for all
using (public.has_mosque_role(mosque_id, array['admin']))
with check (public.has_mosque_role(mosque_id, array['admin']));

drop policy if exists "program teachers visible to mosque staff and assigned teachers" on public.program_teachers;
create policy "program teachers visible to mosque staff and assigned teachers"
on public.program_teachers for select
using (
  teacher_profile_id = auth.uid()
  or exists (
    select 1
    from public.programs p
    where p.id = program_teachers.program_id
      and public.has_mosque_role(p.mosque_id, array['admin', 'teacher'])
  )
);

drop policy if exists "mosque admins manage program teachers" on public.program_teachers;
create policy "mosque admins manage program teachers"
on public.program_teachers for all
using (
  exists (
    select 1
    from public.programs p
    where p.id = program_teachers.program_id
      and public.has_mosque_role(p.mosque_id, array['admin'])
  )
)
with check (
  exists (
    select 1
    from public.programs p
    where p.id = program_teachers.program_id
      and public.has_mosque_role(p.mosque_id, array['admin'])
  )
);

drop policy if exists "enrollment requests visible to owner student parent and staff" on public.enrollment_requests;
create policy "enrollment requests visible to student parent teacher and admin"
on public.enrollment_requests for select
using (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
  or public.has_mosque_role(mosque_id, array['admin', 'teacher'])
);

drop policy if exists "mosque staff review enrollment requests" on public.enrollment_requests;
create policy "teachers and admins review enrollment requests"
on public.enrollment_requests for update
using (public.has_mosque_role(mosque_id, array['admin', 'teacher']))
with check (public.has_mosque_role(mosque_id, array['admin', 'teacher']));
