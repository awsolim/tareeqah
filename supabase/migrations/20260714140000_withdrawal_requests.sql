create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  mosque_id uuid not null references public.mosques(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  student_profile_id uuid not null references public.profiles(id) on delete cascade,
  parent_profile_id uuid references public.profiles(id) on delete set null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  decision_note text,
  teacher_dismissed_at timestamptz,
  student_dismissed_at timestamptz
);

alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_status_check;

alter table public.withdrawal_requests
  add constraint withdrawal_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

create unique index if not exists withdrawal_requests_active_unique
  on public.withdrawal_requests(enrollment_id)
  where status = 'pending';

create index if not exists withdrawal_requests_program_status_idx
  on public.withdrawal_requests(program_id, status, requested_at desc);

alter table public.withdrawal_requests enable row level security;

create or replace function public.request_program_withdrawal(
  target_program_id uuid,
  target_student_profile_id uuid
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
    null,
    null
  )
  on conflict (enrollment_id) where status = 'pending'
  do update set
    requested_at = now(),
    requested_by = excluded.requested_by,
    parent_profile_id = excluded.parent_profile_id,
    teacher_dismissed_at = null,
    student_dismissed_at = null
  returning id into request_id;

  return request_id;
end;
$$;

grant execute on function public.request_program_withdrawal(uuid, uuid) to authenticated;

drop policy if exists "withdrawal requests visible to owner parent and staff" on public.withdrawal_requests;
create policy "withdrawal requests visible to owner parent and staff"
on public.withdrawal_requests for select
using (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
  or requested_by = auth.uid()
  or public.can_manage_program(program_id)
);

drop policy if exists "students and parents create withdrawal requests" on public.withdrawal_requests;
create policy "students and parents create withdrawal requests"
on public.withdrawal_requests for insert
with check (
  requested_by = auth.uid()
  and (
    student_profile_id = auth.uid()
    or exists (
      select 1
      from public.parent_child_links pcl
      where pcl.parent_profile_id = auth.uid()
        and pcl.child_profile_id = withdrawal_requests.student_profile_id
        and pcl.mosque_id = withdrawal_requests.mosque_id
    )
  )
);

drop policy if exists "program staff manage withdrawal requests" on public.withdrawal_requests;
create policy "program staff manage withdrawal requests"
on public.withdrawal_requests for update
using (
  public.can_manage_program(program_id)
  or student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
  or requested_by = auth.uid()
)
with check (
  public.can_manage_program(program_id)
  or student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
  or requested_by = auth.uid()
);
