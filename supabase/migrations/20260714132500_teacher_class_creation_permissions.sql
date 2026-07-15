alter table public.mosque_memberships
  add column if not exists can_create_programs boolean not null default false;

update public.mosque_memberships
set teacher_approval_status = null,
    teacher_approval_reviewed_by = null,
    teacher_approval_reviewed_at = null,
    updated_at = now()
where role = 'teacher';

create or replace function public.is_platform_admin(check_profile_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select false;
$$;

create or replace function public.has_verified_teacher_membership(
  check_mosque_id uuid,
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
    from public.profiles p
    join public.mosque_memberships mm on mm.profile_id = p.id
    where mm.mosque_id = check_mosque_id
      and mm.profile_id = check_profile_id
      and mm.role = 'teacher'
      and mm.status = 'active'
      and p.account_type = 'teacher'
  );
$$;

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
    join public.profiles p on p.id = mm.profile_id
    where mm.mosque_id = check_mosque_id
      and mm.profile_id = check_profile_id
      and mm.status = 'active'
      and mm.role = any(allowed_roles)
      and p.account_type = mm.role
  );
$$;

create or replace function public.can_create_program_in_mosque(
  check_mosque_id uuid,
  check_profile_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_mosque_role(check_mosque_id, array['admin'], check_profile_id)
  or exists (
    select 1
    from public.profiles p
    join public.mosque_memberships mm on mm.profile_id = p.id
    where mm.mosque_id = check_mosque_id
      and mm.profile_id = check_profile_id
      and mm.role = 'teacher'
      and mm.status = 'active'
      and mm.can_create_programs = true
      and p.account_type = 'teacher'
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
    from public.programs p
    where p.id = check_program_id
      and public.has_mosque_role(p.mosque_id, array['admin'], check_profile_id)
  )
  or exists (
    select 1
    from public.program_teachers pt
    join public.programs p on p.id = pt.program_id
    where pt.program_id = check_program_id
      and pt.teacher_profile_id = check_profile_id
      and pt.role in ('director', 'instructor')
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
  select exists (
    select 1
    from public.programs p
    where p.id = check_program_id
      and public.has_mosque_role(p.mosque_id, array['admin'], check_profile_id)
  )
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
  select public.is_program_director(check_program_id, check_profile_id);
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
  signup_full_name text := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', '')
  );
  signup_avatar_url text := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'picture', '')
  );
  signup_gender text := nullif(new.raw_user_meta_data->>'gender', '');
  signup_date_of_birth date := null;
begin
  if nullif(new.raw_user_meta_data->>'date_of_birth', '') is not null then
    signup_date_of_birth := (new.raw_user_meta_data->>'date_of_birth')::date;
  end if;

  perform public.validate_signup_profile_details(signup_account_type, signup_gender, signup_date_of_birth);

  insert into public.profiles (id, full_name, email, phone_number, avatar_url, account_type, age, gender, date_of_birth)
  values (
    new.id,
    signup_full_name,
    new.email,
    nullif(new.raw_user_meta_data->>'phone', ''),
    signup_avatar_url,
    signup_account_type,
    case when signup_account_type = 'student' then nullif(new.raw_user_meta_data->>'age', '') else null end,
    case when signup_account_type in ('student', 'parent') then signup_gender else null end,
    case when signup_account_type in ('student', 'parent') then signup_date_of_birth else null end
  )
  on conflict (id) do update
  set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    email = coalesce(excluded.email, public.profiles.email),
    phone_number = coalesce(excluded.phone_number, public.profiles.phone_number),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    account_type = coalesce(excluded.account_type, public.profiles.account_type),
    age = coalesce(excluded.age, public.profiles.age),
    gender = coalesce(excluded.gender, public.profiles.gender),
    date_of_birth = coalesce(excluded.date_of_birth, public.profiles.date_of_birth),
    updated_at = now();

  if signup_mosque_slug is not null and signup_account_type in ('student', 'parent', 'teacher') then
    select id
    into signup_mosque_id
    from public.mosques
    where slug = signup_mosque_slug
    limit 1;

    if signup_mosque_id is not null then
      update public.mosque_memberships
      set status = 'active',
          teacher_approval_status = null,
          updated_at = now()
      where mosque_id = signup_mosque_id
        and profile_id = new.id
        and role = signup_account_type;

      if not found then
        insert into public.mosque_memberships (mosque_id, profile_id, role, status, teacher_approval_status)
        values (signup_mosque_id, new.id, signup_account_type, 'active', null);
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.complete_oauth_profile(
  signup_account_type text,
  signup_full_name text,
  signup_phone text,
  signup_gender text,
  signup_date_of_birth date,
  signup_mosque_slug text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := auth.uid();
  target_mosque_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.validate_signup_profile_details(signup_account_type, signup_gender, signup_date_of_birth);

  select id
  into target_mosque_id
  from public.mosques
  where slug = signup_mosque_slug
  limit 1;

  if target_mosque_id is null then
    raise exception 'Masjid not found';
  end if;

  update public.profiles
  set
    full_name = coalesce(nullif(trim(signup_full_name), ''), full_name),
    phone_number = nullif(trim(signup_phone), ''),
    account_type = signup_account_type,
    gender = case when signup_account_type in ('student', 'parent') then nullif(signup_gender, '') else null end,
    date_of_birth = case when signup_account_type in ('student', 'parent') then signup_date_of_birth else null end,
    updated_at = now()
  where id = current_profile_id;

  if not found then
    insert into public.profiles (id, full_name, phone_number, account_type, gender, date_of_birth)
    values (
      current_profile_id,
      nullif(trim(signup_full_name), ''),
      nullif(trim(signup_phone), ''),
      signup_account_type,
      case when signup_account_type in ('student', 'parent') then nullif(signup_gender, '') else null end,
      case when signup_account_type in ('student', 'parent') then signup_date_of_birth else null end
    );
  end if;

  update public.mosque_memberships
  set status = 'active',
      teacher_approval_status = null,
      updated_at = now()
  where mosque_id = target_mosque_id
    and profile_id = current_profile_id
    and role = signup_account_type;

  if not found then
    insert into public.mosque_memberships (mosque_id, profile_id, role, status, teacher_approval_status)
    values (target_mosque_id, current_profile_id, signup_account_type, 'active', null);
  end if;
end;
$$;

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
    and pt.teacher_profile_id is null;

  if not found then
    raise exception 'Invalid or already used instructor code';
  end if;

  return target_program_id;
end;
$$;

drop function if exists public.approve_teacher_membership(uuid, text);

drop policy if exists "memberships visible to member and mosque admins" on public.mosque_memberships;
create policy "memberships visible to member and mosque admins"
on public.mosque_memberships for select
using (
  profile_id = auth.uid()
  or public.has_mosque_role(mosque_id, array['admin'])
);

drop policy if exists "mosque admins manage memberships" on public.mosque_memberships;
create policy "mosque admins manage memberships"
on public.mosque_memberships for all
using (public.has_mosque_role(mosque_id, array['admin']))
with check (public.has_mosque_role(mosque_id, array['admin']));

drop policy if exists "program teachers visible to mosque staff and assigned teachers" on public.program_teachers;
create policy "program teachers visible to program staff and mosque admins"
on public.program_teachers for select
using (
  teacher_profile_id = auth.uid()
  or public.is_program_teacher(program_id)
  or exists (
    select 1
    from public.programs p
    where p.id = program_teachers.program_id
      and public.has_mosque_role(p.mosque_id, array['admin'])
  )
);

drop policy if exists "mosque admins manage program teachers" on public.program_teachers;
drop policy if exists "program directors and admins manage program teachers" on public.program_teachers;
create policy "program directors and admins manage program teachers"
on public.program_teachers for all
using (
  public.is_program_director(program_id)
)
with check (
  public.is_program_director(program_id)
);

drop policy if exists "directors instructors and admins review enrollment requests" on public.enrollment_requests;
drop policy if exists "teachers and admins review enrollment requests" on public.enrollment_requests;
create policy "directors and admins review enrollment requests"
on public.enrollment_requests for update
using (
  public.is_program_director(program_id)
)
with check (
  public.is_program_director(program_id)
);

drop policy if exists "enrollment requests visible to owner student parent and staff" on public.enrollment_requests;
drop policy if exists "enrollment requests visible to student parent teacher and admin" on public.enrollment_requests;
create policy "enrollment requests visible to owner and directors"
on public.enrollment_requests for select
using (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
  or public.is_program_director(program_id)
);

drop policy if exists "teachers and admins delete enrollments" on public.enrollments;
create policy "program teachers and admins delete enrollments"
on public.enrollments for delete
using (public.is_program_teacher(program_id));

drop policy if exists "teachers can view request and enrolled student profiles" on public.profiles;
create policy "program teachers can view request and enrolled student profiles"
on public.profiles for select
using (
  exists (
    select 1
    from public.enrollment_requests er
    where er.student_profile_id = profiles.id
      and public.is_program_director(er.program_id)
  )
  or exists (
    select 1
    from public.enrollments e
    where e.student_profile_id = profiles.id
      and public.is_program_teacher(e.program_id)
  )
);

grant execute on function public.complete_oauth_profile(text, text, text, text, date, text) to authenticated;
grant execute on function public.claim_program_instructor_code(text) to authenticated;
