create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists account_type text
  check (account_type is null or account_type in ('student', 'parent', 'teacher', 'admin'));

create table if not exists public.platform_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('platform_admin', 'support')),
  created_at timestamptz not null default now(),
  unique (profile_id, role)
);

create table if not exists public.mosque_memberships (
  id uuid primary key default gen_random_uuid(),
  mosque_id uuid not null references public.mosques(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'teacher', 'staff', 'parent', 'student')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mosque_id, profile_id, role)
);

alter table public.mosque_memberships
  add column if not exists status text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.mosque_memberships
set
  status = coalesce(status, 'active'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.mosque_memberships
  alter column status set default 'active',
  alter column status set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mosque_memberships_status_check'
      and conrelid = 'public.mosque_memberships'::regclass
  ) then
    alter table public.mosque_memberships
      add constraint mosque_memberships_status_check
      check (status in ('active', 'invited', 'suspended'));
  end if;
end $$;

create table if not exists public.program_teachers (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  teacher_profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'lead' check (role in ('lead', 'assistant')),
  created_at timestamptz not null default now(),
  unique (program_id, teacher_profile_id)
);

alter table public.program_teachers
  add column if not exists role text,
  add column if not exists created_at timestamptz;

update public.program_teachers
set
  role = coalesce(role, 'lead'),
  created_at = coalesce(created_at, now());

alter table public.program_teachers
  alter column role set default 'lead',
  alter column role set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'program_teachers_role_check'
      and conrelid = 'public.program_teachers'::regclass
  ) then
    alter table public.program_teachers
      add constraint program_teachers_role_check
      check (role in ('lead', 'assistant'));
  end if;
end $$;

create table if not exists public.enrollment_requests (
  id uuid primary key default gen_random_uuid(),
  mosque_id uuid not null references public.mosques(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  student_profile_id uuid not null references public.profiles(id) on delete cascade,
  parent_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'waitlisted', 'cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  unique (program_id, student_profile_id)
);

create index if not exists platform_roles_profile_idx on public.platform_roles(profile_id);
create index if not exists mosque_memberships_mosque_profile_idx on public.mosque_memberships(mosque_id, profile_id);
create index if not exists mosque_memberships_profile_idx on public.mosque_memberships(profile_id);
create index if not exists program_teachers_program_idx on public.program_teachers(program_id);
create index if not exists program_teachers_teacher_idx on public.program_teachers(teacher_profile_id);
create index if not exists enrollment_requests_program_status_idx on public.enrollment_requests(program_id, status);
create index if not exists enrollment_requests_student_idx on public.enrollment_requests(student_profile_id);

create or replace function public.is_platform_admin(check_profile_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.platform_roles pr
    where pr.profile_id = check_profile_id
      and pr.role = 'platform_admin'
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
  select public.is_platform_admin(check_profile_id)
    or exists (
      select 1
      from public.programs p
      where p.id = check_program_id
        and public.has_mosque_role(p.mosque_id, array['owner', 'admin'], check_profile_id)
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
    nullif(new.raw_user_meta_data->>'age', ''),
    nullif(new.raw_user_meta_data->>'gender', '')
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

  if signup_mosque_slug is not null and signup_account_type in ('student', 'parent', 'teacher') then
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

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

insert into public.profiles (id, full_name, email, phone_number, account_type, age, gender)
select
  au.id,
  nullif(au.raw_user_meta_data->>'full_name', ''),
  au.email,
  nullif(au.raw_user_meta_data->>'phone', ''),
  nullif(au.raw_user_meta_data->>'account_type', ''),
  nullif(au.raw_user_meta_data->>'age', ''),
  nullif(au.raw_user_meta_data->>'gender', '')
from auth.users au
on conflict (id) do update
set
  full_name = coalesce(excluded.full_name, public.profiles.full_name),
  email = coalesce(excluded.email, public.profiles.email),
  phone_number = coalesce(excluded.phone_number, public.profiles.phone_number),
  account_type = coalesce(excluded.account_type, public.profiles.account_type),
  age = coalesce(excluded.age, public.profiles.age),
  gender = coalesce(excluded.gender, public.profiles.gender),
  updated_at = now();

insert into public.program_teachers (program_id, teacher_profile_id, role)
select id, teacher_profile_id, 'lead'
from public.programs
where teacher_profile_id is not null
on conflict (program_id, teacher_profile_id) do nothing;

alter table public.platform_roles enable row level security;
alter table public.mosque_memberships enable row level security;
alter table public.program_teachers enable row level security;
alter table public.enrollment_requests enable row level security;

drop policy if exists "platform roles are visible to self and platform admins" on public.platform_roles;
create policy "platform roles are visible to self and platform admins"
on public.platform_roles for select
using (profile_id = auth.uid() or public.is_platform_admin());

drop policy if exists "platform admins manage platform roles" on public.platform_roles;
create policy "platform admins manage platform roles"
on public.platform_roles for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "memberships visible to member and mosque admins" on public.mosque_memberships;
create policy "memberships visible to member and mosque admins"
on public.mosque_memberships for select
using (
  profile_id = auth.uid()
  or public.has_mosque_role(mosque_id, array['owner', 'admin', 'teacher', 'staff'])
);

drop policy if exists "mosque admins manage memberships" on public.mosque_memberships;
create policy "mosque admins manage memberships"
on public.mosque_memberships for all
using (public.has_mosque_role(mosque_id, array['owner', 'admin']))
with check (public.has_mosque_role(mosque_id, array['owner', 'admin']));

drop policy if exists "program teachers visible to mosque staff and assigned teachers" on public.program_teachers;
create policy "program teachers visible to mosque staff and assigned teachers"
on public.program_teachers for select
using (
  teacher_profile_id = auth.uid()
  or exists (
    select 1
    from public.programs p
    where p.id = program_teachers.program_id
      and public.has_mosque_role(p.mosque_id, array['owner', 'admin', 'teacher', 'staff'])
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
      and public.has_mosque_role(p.mosque_id, array['owner', 'admin'])
  )
)
with check (
  exists (
    select 1
    from public.programs p
    where p.id = program_teachers.program_id
      and public.has_mosque_role(p.mosque_id, array['owner', 'admin'])
  )
);

drop policy if exists "enrollment requests visible to owner student parent and staff" on public.enrollment_requests;
create policy "enrollment requests visible to owner student parent and staff"
on public.enrollment_requests for select
using (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
  or public.has_mosque_role(mosque_id, array['owner', 'admin', 'teacher', 'staff'])
);

drop policy if exists "students and parents create enrollment requests" on public.enrollment_requests;
create policy "students and parents create enrollment requests"
on public.enrollment_requests for insert
with check (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
);

drop policy if exists "mosque staff review enrollment requests" on public.enrollment_requests;
create policy "mosque staff review enrollment requests"
on public.enrollment_requests for update
using (public.has_mosque_role(mosque_id, array['owner', 'admin', 'teacher', 'staff']))
with check (public.has_mosque_role(mosque_id, array['owner', 'admin', 'teacher', 'staff']));
