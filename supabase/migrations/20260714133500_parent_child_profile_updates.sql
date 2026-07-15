create or replace function public.update_parent_child_profile(
  child_profile_id uuid,
  child_full_name text,
  child_gender text,
  child_date_of_birth date,
  child_mosque_slug text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_id uuid := auth.uid();
  target_mosque_id uuid;
  target_child_profile_id uuid := child_profile_id;
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

  if nullif(trim(child_full_name), '') is null then
    raise exception 'Child name is required';
  end if;

  if child_gender not in ('male', 'female') then
    raise exception 'Invalid gender';
  end if;

  if child_date_of_birth is null then
    raise exception 'Date of birth is required';
  end if;

  if not exists (
    select 1
    from public.parent_child_links pcl
    where pcl.parent_profile_id = parent_id
      and pcl.child_profile_id = target_child_profile_id
      and pcl.mosque_id = target_mosque_id
  ) then
    raise exception 'Child profile not found or not authorized';
  end if;

  update public.profiles
  set full_name = nullif(trim(child_full_name), ''),
      gender = child_gender,
      date_of_birth = child_date_of_birth,
      age = null,
      updated_at = now()
  where id = target_child_profile_id
    and account_type = 'student';

  if not found then
    raise exception 'Child profile not found';
  end if;
end;
$$;

grant execute on function public.update_parent_child_profile(uuid, text, text, date, text) to authenticated;
