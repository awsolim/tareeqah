create or replace function public.update_enrollment_track_selection(
  target_enrollment_id uuid,
  selected_track_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := auth.uid();
  target_program_id uuid;
  target_student_id uuid;
  target_mosque_id uuid;
  target_track_mode text;
  target_track_count integer;
  target_age_range text;
  target_audience_gender text;
  target_student_age integer;
  target_student_gender text;
  active_track_count integer;
  selected_count integer;
  required_count integer;
  normalized_track_ids uuid[] := coalesce(selected_track_ids, '{}'::uuid[]);
  normalized_age_range text;
  min_age integer;
  max_age integer;
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  select e.program_id,
         e.student_profile_id,
         p.mosque_id,
         coalesce(p.track_selection_mode, 'exact'),
         greatest(coalesce(p.track_selection_count, 1), 1),
         p.age_range_text,
         p.audience_gender,
         case
           when pr.date_of_birth is not null then extract(year from age(current_date, pr.date_of_birth))::integer
           when pr.age ~ '^[0-9]+$' then pr.age::integer
           else null
         end,
         lower(nullif(trim(pr.gender), ''))
  into target_program_id,
       target_student_id,
       target_mosque_id,
       target_track_mode,
       target_track_count,
       target_age_range,
       target_audience_gender,
       target_student_age,
       target_student_gender
  from public.enrollments e
  join public.programs p on p.id = e.program_id
  join public.profiles pr on pr.id = e.student_profile_id
  where e.id = target_enrollment_id;

  if target_program_id is null then
    raise exception 'Enrollment not found';
  end if;

  if target_student_id <> current_profile_id and not exists (
    select 1
    from public.parent_child_links pcl
    where pcl.parent_profile_id = current_profile_id
      and pcl.child_profile_id = target_student_id
      and pcl.mosque_id = target_mosque_id
  ) then
    raise exception 'Not authorized to update this enrollment';
  end if;

  if lower(coalesce(target_audience_gender, '')) in ('brothers', 'brothers only', 'male', 'boys')
     and target_student_gender <> 'male' then
    raise exception 'Student no longer matches the audience requirement';
  end if;

  if lower(coalesce(target_audience_gender, '')) in ('sisters', 'sisters only', 'female', 'girls')
     and target_student_gender <> 'female' then
    raise exception 'Student no longer matches the audience requirement';
  end if;

  normalized_age_range := lower(trim(coalesce(target_age_range, '')));
  if normalized_age_range <> '' and normalized_age_range not in ('all', 'all ages') then
    normalized_age_range := regexp_replace(normalized_age_range, '^ages?\s+', '');

    if normalized_age_range ~ '^[0-9]+\s*[-–]\s*[0-9]+$' then
      min_age := (regexp_match(normalized_age_range, '^([0-9]+)'))[1]::integer;
      max_age := (regexp_match(normalized_age_range, '([0-9]+)$'))[1]::integer;
    elsif normalized_age_range ~ '^[0-9]+\s*\+$' then
      min_age := (regexp_match(normalized_age_range, '^([0-9]+)'))[1]::integer;
      max_age := null;
    elsif normalized_age_range ~ '^[0-9]+$' then
      min_age := normalized_age_range::integer;
      max_age := normalized_age_range::integer;
    end if;

    if min_age is not null and target_student_age is null then
      raise exception 'Student is missing the age requirement for this class';
    end if;
    if min_age is not null and target_student_age < min_age then
      raise exception 'Student is outside of the class age range';
    end if;
    if max_age is not null and target_student_age > max_age then
      raise exception 'Student is outside of the class age range';
    end if;
  end if;

  select count(*)
  into active_track_count
  from public.program_tracks pt
  where pt.program_id = target_program_id
    and pt.is_active = true;

  select count(distinct track_id)
  into selected_count
  from unnest(normalized_track_ids) as track_id;

  if active_track_count = 0 then
    selected_count := 0;
  else
    if selected_count = 0 then
      raise exception 'Choose at least one schedule option';
    end if;

    if exists (
      select 1
      from unnest(normalized_track_ids) as track_id
      left join public.program_tracks pt
        on pt.id = track_id
       and pt.program_id = target_program_id
       and pt.is_active = true
      where pt.id is null
    ) then
      raise exception 'One or more selected schedule options are invalid';
    end if;

    required_count := least(target_track_count, active_track_count);
    if target_track_mode = 'minimum' and selected_count < required_count then
      raise exception 'Choose at least % schedule option(s)', required_count;
    elsif target_track_mode = 'maximum' and selected_count > required_count then
      raise exception 'Choose no more than % schedule option(s)', required_count;
    elsif target_track_mode = 'exact' and selected_count <> required_count then
      raise exception 'Choose exactly % schedule option(s)', required_count;
    end if;
  end if;

  delete from public.enrollment_tracks
  where enrollment_id = target_enrollment_id;

  if active_track_count > 0 then
    insert into public.enrollment_tracks (enrollment_id, program_track_id)
    select target_enrollment_id, track_id
    from (
      select distinct track_id
      from unnest(normalized_track_ids) as track_id
    ) selected;
  end if;

  update public.enrollments
  set program_track_id = case when active_track_count > 0 then normalized_track_ids[1] else null end
  where id = target_enrollment_id;
end;
$$;

grant execute on function public.update_enrollment_track_selection(uuid, uuid[]) to authenticated;
