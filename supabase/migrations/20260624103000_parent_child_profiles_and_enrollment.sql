create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists date_of_birth date;

create table if not exists public.parent_child_links (
  id uuid primary key default gen_random_uuid(),
  parent_profile_id uuid not null references public.profiles(id) on delete cascade,
  child_profile_id uuid not null references public.profiles(id) on delete cascade,
  mosque_id uuid not null references public.mosques(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (parent_profile_id, child_profile_id, mosque_id)
);

create index if not exists parent_child_links_parent_idx
  on public.parent_child_links(parent_profile_id, mosque_id);

create index if not exists parent_child_links_child_idx
  on public.parent_child_links(child_profile_id, mosque_id);

alter table public.parent_child_links enable row level security;

create or replace function public.can_view_child_guardian_link(
  check_child_profile_id uuid,
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
    from public.enrollment_requests er
    where er.student_profile_id = check_child_profile_id
      and public.can_manage_program(er.program_id, check_profile_id)
  )
  or exists (
    select 1
    from public.enrollments e
    where e.student_profile_id = check_child_profile_id
      and public.can_manage_program(e.program_id, check_profile_id)
  );
$$;

create or replace function public.is_parent_of_child(
  check_child_profile_id uuid,
  check_parent_profile_id uuid default auth.uid(),
  check_mosque_id uuid default null
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.parent_child_links pcl
    where pcl.parent_profile_id = check_parent_profile_id
      and pcl.child_profile_id = check_child_profile_id
      and (check_mosque_id is null or pcl.mosque_id = check_mosque_id)
  );
$$;

create or replace function public.can_manage_parent_profile(
  check_parent_profile_id uuid,
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
    from public.parent_child_links pcl
    join public.enrollments e on e.student_profile_id = pcl.child_profile_id
    where pcl.parent_profile_id = check_parent_profile_id
      and public.can_manage_program(e.program_id, check_profile_id)
  )
  or exists (
    select 1
    from public.parent_child_links pcl
    join public.enrollment_requests er on er.student_profile_id = pcl.child_profile_id
    where pcl.parent_profile_id = check_parent_profile_id
      and public.can_manage_program(er.program_id, check_profile_id)
  );
$$;

create or replace function public.create_parent_child_profile(
  child_full_name text,
  child_gender text,
  child_date_of_birth date,
  child_mosque_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_id uuid := auth.uid();
  child_id uuid := gen_random_uuid();
  target_mosque_id uuid;
begin
  if parent_id is null then
    raise exception 'Not authenticated';
  end if;

  select id
  into target_mosque_id
  from public.mosques
  where slug = child_mosque_slug
  limit 1;

  if target_mosque_id is null then
    raise exception 'Masjid not found';
  end if;

  if not public.has_mosque_role(target_mosque_id, array['parent'], parent_id) then
    raise exception 'Parent membership required';
  end if;

  insert into public.profiles (id, full_name, account_type, gender, date_of_birth)
  values (
    child_id,
    nullif(trim(child_full_name), ''),
    'student',
    nullif(child_gender, ''),
    child_date_of_birth
  );

  insert into public.parent_child_links (parent_profile_id, child_profile_id, mosque_id)
  values (parent_id, child_id, target_mosque_id);

  update public.mosque_memberships
  set status = 'active',
      updated_at = now()
  where mosque_id = target_mosque_id
    and profile_id = child_id
    and role = 'student';

  if not found then
    insert into public.mosque_memberships (mosque_id, profile_id, role, status)
    values (target_mosque_id, child_id, 'student', 'active');
  end if;

  return child_id;
end;
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
  insert into public.profiles (id, full_name, email, phone_number, account_type, age, gender, date_of_birth)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    nullif(new.raw_user_meta_data->>'phone', ''),
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
    account_type = coalesce(excluded.account_type, public.profiles.account_type),
    age = coalesce(excluded.age, public.profiles.age),
    gender = coalesce(excluded.gender, public.profiles.gender),
    date_of_birth = coalesce(excluded.date_of_birth, public.profiles.date_of_birth),
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

drop policy if exists "parents manage their child links" on public.parent_child_links;
create policy "parents manage their child links"
on public.parent_child_links for all
using (parent_profile_id = auth.uid())
with check (
  parent_profile_id = auth.uid()
  and public.has_mosque_role(mosque_id, array['parent'], auth.uid())
);

drop policy if exists "teachers view linked guardians for their students" on public.parent_child_links;
create policy "teachers view linked guardians for their students"
on public.parent_child_links for select
using (public.can_view_child_guardian_link(child_profile_id));

drop policy if exists "students and parents create enrollment requests" on public.enrollment_requests;
create policy "students and parents create enrollment requests"
on public.enrollment_requests for insert
with check (
  (
    student_profile_id = auth.uid()
    and parent_profile_id is null
  )
  or (
    parent_profile_id = auth.uid()
    and public.is_parent_of_child(enrollment_requests.student_profile_id, auth.uid(), enrollment_requests.mosque_id)
  )
);

drop policy if exists "students cancel and dismiss own enrollment requests" on public.enrollment_requests;
drop policy if exists "students and parents cancel and dismiss own enrollment requests" on public.enrollment_requests;
create policy "students and parents cancel and dismiss own enrollment requests"
on public.enrollment_requests for update
using (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
)
with check (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
);

drop policy if exists "parents can view child profiles" on public.profiles;
create policy "parents can view child profiles"
on public.profiles for select
using (public.is_parent_of_child(profiles.id));

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "teachers can view request and enrolled student profiles" on public.profiles;
drop policy if exists "teachers can view request enrolled student and parent profiles" on public.profiles;
create policy "teachers can view request enrolled student and parent profiles"
on public.profiles for select
using (
  exists (
    select 1
    from public.enrollment_requests er
    where er.student_profile_id = profiles.id
      and public.can_manage_program(er.program_id)
  )
  or exists (
    select 1
    from public.enrollment_requests er
    where er.parent_profile_id = profiles.id
      and public.can_manage_program(er.program_id)
  )
  or exists (
    select 1
    from public.enrollments e
    where e.student_profile_id = profiles.id
      and public.can_manage_program(e.program_id)
  )
  or public.can_manage_parent_profile(profiles.id)
);
