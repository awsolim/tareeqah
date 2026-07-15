alter table public.withdrawal_requests
  add column if not exists reason text,
  add column if not exists understands_no_refund boolean not null default false,
  add column if not exists understands_immediate_exit boolean not null default false;

alter table public.withdrawal_requests
  alter column enrollment_id drop not null;

alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_enrollment_id_fkey;

alter table public.withdrawal_requests
  add constraint withdrawal_requests_enrollment_id_fkey
  foreign key (enrollment_id) references public.enrollments(id) on delete set null;

drop function if exists public.request_program_withdrawal(uuid, uuid);

create or replace function public.request_program_withdrawal(
  target_program_id uuid,
  target_student_profile_id uuid,
  withdrawal_reason text default null,
  understands_no_refund boolean default false,
  understands_immediate_exit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := auth.uid();
  target_enrollment_id uuid;
  target_mosque_id uuid;
  requester_parent_id uuid := null;
  request_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  if understands_no_refund is not true or understands_immediate_exit is not true then
    raise exception 'Withdrawal acknowledgements are required';
  end if;

  select e.id, p.mosque_id
  into target_enrollment_id, target_mosque_id
  from public.enrollments e
  join public.programs p on p.id = e.program_id
  where e.program_id = target_program_id
    and e.student_profile_id = target_student_profile_id
  limit 1;

  if target_enrollment_id is null then
    raise exception 'Enrollment not found';
  end if;

  if target_student_profile_id <> current_profile_id then
    if not exists (
      select 1
      from public.parent_child_links pcl
      where pcl.parent_profile_id = current_profile_id
        and pcl.child_profile_id = target_student_profile_id
        and pcl.mosque_id = target_mosque_id
    ) then
      raise exception 'Not authorized to request this withdrawal';
    end if;
    requester_parent_id := current_profile_id;
  end if;

  insert into public.withdrawal_requests (
    mosque_id,
    program_id,
    enrollment_id,
    student_profile_id,
    parent_profile_id,
    requested_by,
    status,
    reason,
    understands_no_refund,
    understands_immediate_exit,
    teacher_dismissed_at,
    student_dismissed_at
  )
  values (
    target_mosque_id,
    target_program_id,
    target_enrollment_id,
    target_student_profile_id,
    requester_parent_id,
    current_profile_id,
    'pending',
    nullif(trim(withdrawal_reason), ''),
    true,
    true,
    null,
    null
  )
  on conflict (enrollment_id) where status = 'pending'
  do update set
    requested_at = now(),
    requested_by = excluded.requested_by,
    parent_profile_id = excluded.parent_profile_id,
    reason = excluded.reason,
    understands_no_refund = true,
    understands_immediate_exit = true,
    teacher_dismissed_at = null,
    student_dismissed_at = null
  returning id into request_id;

  return request_id;
end;
$$;

grant execute on function public.request_program_withdrawal(uuid, uuid, text, boolean, boolean) to authenticated;
