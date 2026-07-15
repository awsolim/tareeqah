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
      membership_status := 'active';
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

  membership_status := 'active';
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
  set status = case when target_status = 'verified' then 'active' else 'suspended' end,
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

grant execute on function public.complete_oauth_profile(text, text, text, text, date, text) to authenticated;
grant execute on function public.approve_teacher_membership(uuid, text) to authenticated;
