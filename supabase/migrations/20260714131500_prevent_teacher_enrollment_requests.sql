create or replace function public.is_staff_account(check_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = check_profile_id
      and p.account_type in ('teacher', 'admin')
  );
$$;

create or replace function public.is_teacher_account(check_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = check_profile_id
      and p.account_type = 'teacher'
  );
$$;

create or replace function public.prevent_teacher_enrollment_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_staff_account(new.student_profile_id) then
    raise exception 'Staff accounts cannot request enrollment';
  end if;

  if new.parent_profile_id is not null and public.is_staff_account(new.parent_profile_id) then
    raise exception 'Staff accounts cannot request enrollment';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_teacher_enrollment_request_trigger on public.enrollment_requests;
create trigger prevent_teacher_enrollment_request_trigger
before insert or update of student_profile_id, parent_profile_id
on public.enrollment_requests
for each row
execute function public.prevent_teacher_enrollment_request();

drop policy if exists "students and parents create enrollment requests" on public.enrollment_requests;
create policy "students and parents create enrollment requests"
on public.enrollment_requests for insert
with check (
  not public.is_staff_account(auth.uid())
  and not public.is_staff_account(student_profile_id)
  and (
    (
      student_profile_id = auth.uid()
      and parent_profile_id is null
    )
    or (
      parent_profile_id = auth.uid()
      and public.is_parent_of_child(enrollment_requests.student_profile_id, auth.uid(), enrollment_requests.mosque_id)
    )
  )
);
