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
      insert into public.mosque_memberships (mosque_id, profile_id, role, status)
      values (signup_mosque_id, new.id, signup_account_type, 'active')
      on conflict (mosque_id, profile_id, role) do update
      set status = 'active',
          updated_at = now();
    end if;
  end if;

  return new;
end;
$$;

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
