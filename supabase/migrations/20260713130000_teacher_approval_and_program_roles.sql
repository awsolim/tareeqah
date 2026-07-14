alter table public.mosque_memberships
  add column if not exists teacher_approval_status text,
  add column if not exists teacher_approval_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists teacher_approval_reviewed_at timestamptz;

alter table public.program_teachers
  add column if not exists invite_code text,
  add column if not exists invite_code_created_at timestamptz;

alter table public.program_teachers
  alter column teacher_profile_id drop not null;

update public.mosque_memberships
set teacher_approval_status = case
  when role = 'teacher' and status = 'active' then 'verified'
  when role = 'teacher' then 'pending'
  else null
end
where role = 'teacher'
  and teacher_approval_status is null;

update public.program_teachers
set role = case
  when role = 'lead' then 'director'
  when role = 'assistant' then 'instructor'
end
where role in ('lead', 'assistant');

alter table public.program_teachers
  drop constraint if exists program_teachers_role_check;

alter table public.program_teachers
  add constraint program_teachers_role_check
  check (role in ('director', 'instructor'));

alter table public.mosque_memberships
  drop constraint if exists mosque_memberships_teacher_approval_status_check;

alter table public.mosque_memberships
  add constraint mosque_memberships_teacher_approval_status_check
  check (
    teacher_approval_status is null
    or teacher_approval_status in ('pending', 'verified', 'rejected')
  );

create unique index if not exists program_teachers_one_director_idx
  on public.program_teachers(program_id)
  where role = 'director';

create unique index if not exists program_teachers_invite_code_idx
  on public.program_teachers(invite_code)
  where invite_code is not null;

create or replace function public.is_platform_admin(check_profile_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = check_profile_id
      and p.global_role = 'platform_admin'
  );
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
    from public.mosque_memberships mm
    where mm.mosque_id = check_mosque_id
      and mm.profile_id = check_profile_id
      and mm.role = 'teacher'
      and mm.status = 'active'
      and mm.teacher_approval_status = 'verified'
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
  select public.is_platform_admin(check_profile_id)
  or exists (
    select 1
    from public.mosque_memberships mm
    where mm.mosque_id = check_mosque_id
      and mm.profile_id = check_profile_id
      and mm.status = 'active'
      and mm.role = any(allowed_roles)
      and (
        mm.role <> 'teacher'
        or coalesce(mm.teacher_approval_status, 'verified') = 'verified'
      )
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
      and p.teacher_profile_id = check_profile_id
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
      and p.teacher_profile_id = check_profile_id
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
  select exists (
    select 1
    from public.programs p
    where p.id = check_program_id
      and public.has_mosque_role(p.mosque_id, array['admin'], check_profile_id)
  )
  or public.is_program_director(check_program_id, check_profile_id);
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
  membership_status text;
  teacher_approval text;
begin
  insert into public.profiles (id, full_name, email, phone_number, avatar_url, account_type, age, gender, date_of_birth)
  values (
    new.id,
    signup_full_name,
    new.email,
    nullif(new.raw_user_meta_data->>'phone', ''),
    signup_avatar_url,
    signup_account_type,
    case when signup_account_type = 'student' then nullif(new.raw_user_meta_data->>'age', '') else null end,
    case when signup_account_type = 'student' then nullif(new.raw_user_meta_data->>'gender', '') else null end,
    case
      when signup_account_type = 'student' and nullif(new.raw_user_meta_data->>'date_of_birth', '') is not null
        then (new.raw_user_meta_data->>'date_of_birth')::date
      else null
    end
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
      membership_status := case when signup_account_type = 'teacher' then 'pending' else 'active' end;
      teacher_approval := case when signup_account_type = 'teacher' then 'pending' else null end;

      update public.mosque_memberships
      set status = membership_status,
          teacher_approval_status = teacher_approval,
          updated_at = now()
      where mosque_id = signup_mosque_id
        and profile_id = new.id
        and role = signup_account_type;

      if not found then
        insert into public.mosque_memberships (mosque_id, profile_id, role, status, teacher_approval_status)
        values (signup_mosque_id, new.id, signup_account_type, membership_status, teacher_approval);
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
  membership_status text;
  teacher_approval text;
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  if signup_account_type not in ('student', 'parent', 'teacher') then
    raise exception 'Invalid account type';
  end if;

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
    gender = case when signup_account_type = 'student' then nullif(signup_gender, '') else null end,
    date_of_birth = case when signup_account_type = 'student' then signup_date_of_birth else null end,
    updated_at = now()
  where id = current_profile_id;

  if not found then
    insert into public.profiles (id, full_name, phone_number, account_type, gender, date_of_birth)
    values (
      current_profile_id,
      nullif(trim(signup_full_name), ''),
      nullif(trim(signup_phone), ''),
      signup_account_type,
      case when signup_account_type = 'student' then nullif(signup_gender, '') else null end,
      case when signup_account_type = 'student' then signup_date_of_birth else null end
    );
  end if;

  membership_status := case when signup_account_type = 'teacher' then 'pending' else 'active' end;
  teacher_approval := case when signup_account_type = 'teacher' then 'pending' else null end;

  update public.mosque_memberships
  set status = membership_status,
      teacher_approval_status = teacher_approval,
      updated_at = now()
  where mosque_id = target_mosque_id
    and profile_id = current_profile_id
    and role = signup_account_type;

  if not found then
    insert into public.mosque_memberships (mosque_id, profile_id, role, status, teacher_approval_status)
    values (target_mosque_id, current_profile_id, signup_account_type, membership_status, teacher_approval);
  end if;
end;
$$;

create or replace function public.approve_teacher_membership(
  target_membership_id uuid,
  target_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewer_id uuid := auth.uid();
begin
  if reviewer_id is null then
    raise exception 'Not authenticated';
  end if;

  if target_status not in ('verified', 'rejected') then
    raise exception 'Invalid teacher status';
  end if;

  update public.mosque_memberships mm
  set status = case when target_status = 'verified' then 'active' else 'inactive' end,
      teacher_approval_status = target_status,
      teacher_approval_reviewed_by = reviewer_id,
      teacher_approval_reviewed_at = now(),
      updated_at = now()
  where mm.id = target_membership_id
    and mm.role = 'teacher'
    and (
      public.is_platform_admin(reviewer_id)
      or public.has_mosque_role(mm.mosque_id, array['admin'], reviewer_id)
    );

  if not found then
    raise exception 'Teacher request not found or not authorized';
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

  update public.program_teachers
  set teacher_profile_id = current_profile_id
  where program_id = target_program_id
    and role = 'instructor'
    and invite_code = normalized_invite
    and teacher_profile_id is null;

  return target_program_id;
end;
$$;

drop policy if exists "memberships visible to member and mosque admins" on public.mosque_memberships;
create policy "memberships visible to member and mosque admins"
on public.mosque_memberships for select
using (
  profile_id = auth.uid()
  or public.is_platform_admin()
  or public.has_mosque_role(mosque_id, array['admin', 'teacher'])
);

drop policy if exists "mosque admins manage memberships" on public.mosque_memberships;
create policy "mosque admins manage memberships"
on public.mosque_memberships for all
using (public.is_platform_admin() or public.has_mosque_role(mosque_id, array['admin']))
with check (public.is_platform_admin() or public.has_mosque_role(mosque_id, array['admin']));

drop policy if exists "program teachers visible to mosque staff and assigned teachers" on public.program_teachers;
create policy "program teachers visible to mosque staff and assigned teachers"
on public.program_teachers for select
using (
  teacher_profile_id = auth.uid()
  or public.is_program_director(program_id)
  or exists (
    select 1
    from public.programs p
    where p.id = program_teachers.program_id
      and public.has_mosque_role(p.mosque_id, array['admin', 'teacher'])
  )
);

drop policy if exists "mosque admins manage program teachers" on public.program_teachers;
create policy "program directors and admins manage program teachers"
on public.program_teachers for all
using (
  public.is_program_director(program_id)
  or exists (
    select 1
    from public.programs p
    where p.id = program_teachers.program_id
      and public.has_mosque_role(p.mosque_id, array['admin'])
  )
)
with check (
  public.is_program_director(program_id)
  or exists (
    select 1
    from public.programs p
    where p.id = program_teachers.program_id
      and public.has_mosque_role(p.mosque_id, array['admin'])
  )
);

drop policy if exists "teachers and admins review enrollment requests" on public.enrollment_requests;
create policy "directors instructors and admins review enrollment requests"
on public.enrollment_requests for update
using (
  public.has_mosque_role(mosque_id, array['admin'])
  or public.is_program_teacher(program_id)
)
with check (
  public.has_mosque_role(mosque_id, array['admin'])
  or public.is_program_teacher(program_id)
);

grant execute on function public.approve_teacher_membership(uuid, text) to authenticated;
grant execute on function public.claim_program_instructor_code(text) to authenticated;
