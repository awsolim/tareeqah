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
  case when au.raw_user_meta_data->>'account_type' = 'student' then nullif(au.raw_user_meta_data->>'age', '') else null end,
  case when au.raw_user_meta_data->>'account_type' = 'student' then nullif(au.raw_user_meta_data->>'gender', '') else null end
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

insert into public.mosque_memberships (mosque_id, profile_id, role, status)
select
  m.id,
  au.id,
  au.raw_user_meta_data->>'account_type',
  'active'
from auth.users au
join public.mosques m on m.slug = au.raw_user_meta_data->>'mosque_slug'
where au.raw_user_meta_data->>'account_type' in ('student', 'parent')
  and not exists (
    select 1
    from public.mosque_memberships mm
    where mm.mosque_id = m.id
      and mm.profile_id = au.id
      and mm.role = au.raw_user_meta_data->>'account_type'
  );
