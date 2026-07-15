create or replace function public.validate_signup_profile_details(
  signup_account_type text,
  signup_gender text,
  signup_date_of_birth date
)
returns void
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  minimum_birth_date date;
begin
  if signup_account_type not in ('student', 'parent', 'teacher') then
    raise exception 'Invalid account type';
  end if;

  if signup_account_type in ('student', 'parent') then
    if nullif(trim(coalesce(signup_gender, '')), '') is null then
      raise exception 'Gender is required';
    end if;

    if signup_gender not in ('male', 'female') then
      raise exception 'Invalid gender';
    end if;

    if signup_date_of_birth is null then
      raise exception 'Date of birth is required';
    end if;

    if signup_date_of_birth > current_date then
      raise exception 'Date of birth cannot be in the future';
    end if;

    minimum_birth_date := case
      when signup_account_type = 'student' then current_date - interval '13 years'
      else current_date - interval '18 years'
    end;

    if signup_date_of_birth > minimum_birth_date then
      raise exception '% accounts require date of birth to be at least % years old',
        initcap(signup_account_type),
        case when signup_account_type = 'student' then 13 else 18 end;
    end if;
  end if;
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
  membership_status text;
  teacher_approval text;
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

grant execute on function public.complete_oauth_profile(text, text, text, text, date, text) to authenticated;
