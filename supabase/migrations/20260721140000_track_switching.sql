-- Track switching. Post-enrollment track changes already worked, completely unrestricted,
-- via update_enrollment_track_selection (StudentScheduleOptionsData). This adds a per-program
-- policy gate (disabled / request_only / allowed), an explicit from->to transfer-rule
-- allow-list, and a request/approval flow for the "request_only" mode.

alter table public.programs
  add column if not exists track_switch_policy text not null default 'disabled',
  add column if not exists track_switch_allow_all boolean not null default false;

alter table public.programs
  drop constraint if exists programs_track_switch_policy_check,
  add constraint programs_track_switch_policy_check
  check (track_switch_policy in ('disabled', 'request_only', 'allowed'));

create table if not exists public.program_track_transfer_rules (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  from_track_id uuid not null references public.program_tracks(id) on delete cascade,
  to_track_id uuid not null references public.program_tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint program_track_transfer_rules_distinct check (from_track_id <> to_track_id)
);

create unique index if not exists program_track_transfer_rules_unique
  on public.program_track_transfer_rules(program_id, from_track_id, to_track_id);

alter table public.program_track_transfer_rules enable row level security;

drop policy if exists "anyone can view transfer rules" on public.program_track_transfer_rules;
create policy "anyone can view transfer rules"
on public.program_track_transfer_rules for select
using (true);

drop policy if exists "program managers manage transfer rules" on public.program_track_transfer_rules;
create policy "program managers manage transfer rules"
on public.program_track_transfer_rules for all
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

create table if not exists public.program_track_switch_requests (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  student_profile_id uuid not null references public.profiles(id) on delete cascade,
  from_track_ids uuid[] not null default '{}',
  to_track_ids uuid[] not null default '{}',
  status text not null default 'pending',
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_note text
);

alter table public.program_track_switch_requests
  drop constraint if exists program_track_switch_requests_status_check,
  add constraint program_track_switch_requests_status_check
  check (status in ('pending', 'approved', 'rejected'));

create index if not exists program_track_switch_requests_program_idx
  on public.program_track_switch_requests(program_id, status);

alter table public.program_track_switch_requests enable row level security;

drop policy if exists "students and parents view own switch requests" on public.program_track_switch_requests;
create policy "students and parents view own switch requests"
on public.program_track_switch_requests for select
using (
  student_profile_id = auth.uid()
  or exists (
    select 1 from public.parent_child_links pcl
    where pcl.child_profile_id = program_track_switch_requests.student_profile_id
      and pcl.parent_profile_id = auth.uid()
  )
  or public.can_manage_program(program_id)
);

drop policy if exists "students and parents create switch requests" on public.program_track_switch_requests;
create policy "students and parents create switch requests"
on public.program_track_switch_requests for insert
with check (
  student_profile_id = auth.uid()
  or exists (
    select 1 from public.parent_child_links pcl
    where pcl.child_profile_id = program_track_switch_requests.student_profile_id
      and pcl.parent_profile_id = auth.uid()
  )
);

-- Update/decide only via the security-definer RPCs below (they re-check can_manage_program
-- themselves); no direct-update policy is needed for program managers.

-- Re-created with the new policy gate, transfer-rule check, and per-track eligibility
-- override check layered on top of the original validation.
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
  target_switch_policy text;
  target_switch_allow_all boolean;
  active_track_count integer;
  selected_count integer;
  required_count integer;
  normalized_track_ids uuid[] := coalesce(selected_track_ids, '{}'::uuid[]);
  normalized_age_range text;
  min_age integer;
  max_age integer;
  current_track_ids uuid[];
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
         lower(nullif(trim(pr.gender), '')),
         p.track_switch_policy,
         p.track_switch_allow_all
  into target_program_id,
       target_student_id,
       target_mosque_id,
       target_track_mode,
       target_track_count,
       target_age_range,
       target_audience_gender,
       target_student_age,
       target_student_gender,
       target_switch_policy,
       target_switch_allow_all
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

  if target_switch_policy is distinct from 'allowed' then
    raise exception 'Self-service schedule changes are not enabled for this class';
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

    -- Per-track eligibility override: a track's own age/gender override (if set) wins
    -- over the program-level requirement already checked above.
    if exists (
      select 1
      from unnest(normalized_track_ids) as track_id
      join public.program_tracks pt on pt.id = track_id
      where (pt.age_min is not null and (target_student_age is null or target_student_age < pt.age_min))
         or (pt.age_max is not null and (target_student_age is null or target_student_age > pt.age_max))
         or (pt.gender_override = 'brothers' and target_student_gender <> 'male')
         or (pt.gender_override = 'sisters' and target_student_gender <> 'female')
    ) then
      raise exception 'Student does not meet the eligibility requirements for the selected schedule option';
    end if;

    -- Transfer-rule check: every currently-held track -> newly-selected track pair must
    -- be an explicitly allowed transfer, unless the program allows all switches.
    if not target_switch_allow_all then
      select array_agg(program_track_id) into current_track_ids
      from public.enrollment_tracks
      where enrollment_id = target_enrollment_id;

      if exists (
        select 1
        from unnest(coalesce(current_track_ids, '{}'::uuid[])) as from_id
        cross join unnest(normalized_track_ids) as to_id
        where from_id <> to_id
          and not exists (
            select 1 from public.program_track_transfer_rules r
            where r.program_id = target_program_id
              and r.from_track_id = from_id
              and r.to_track_id = to_id
          )
      ) then
        raise exception 'That schedule change is not allowed for this class';
      end if;
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

create or replace function public.approve_track_switch_request(
  target_request_id uuid,
  decision_note_text text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  req record;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into req from public.program_track_switch_requests where id = target_request_id;
  if req.id is null then
    raise exception 'Switch request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been decided';
  end if;
  if not public.can_manage_program(req.program_id, actor_id) then
    raise exception 'Not authorized to manage this class';
  end if;

  delete from public.enrollment_tracks where enrollment_id = req.enrollment_id;
  insert into public.enrollment_tracks (enrollment_id, program_track_id)
  select req.enrollment_id, track_id from unnest(req.to_track_ids) as track_id;

  update public.enrollments
  set program_track_id = req.to_track_ids[1]
  where id = req.enrollment_id;

  update public.program_track_switch_requests
  set status = 'approved', decided_at = now(), decided_by = actor_id, decision_note = decision_note_text
  where id = target_request_id;
end;
$$;

grant execute on function public.approve_track_switch_request(uuid, text) to authenticated;

create or replace function public.reject_track_switch_request(
  target_request_id uuid,
  decision_note_text text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  req record;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into req from public.program_track_switch_requests where id = target_request_id;
  if req.id is null then
    raise exception 'Switch request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been decided';
  end if;
  if not public.can_manage_program(req.program_id, actor_id) then
    raise exception 'Not authorized to manage this class';
  end if;

  update public.program_track_switch_requests
  set status = 'rejected', decided_at = now(), decided_by = actor_id, decision_note = decision_note_text
  where id = target_request_id;
end;
$$;

grant execute on function public.reject_track_switch_request(uuid, text) to authenticated;
