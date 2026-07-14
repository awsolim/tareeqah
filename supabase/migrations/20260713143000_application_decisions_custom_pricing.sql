alter table public.enrollment_requests
  add column if not exists approved_price_monthly_cents integer,
  add column if not exists payment_bypassed boolean not null default false,
  add column if not exists decision_note text;

alter table public.enrollment_requests
  drop constraint if exists enrollment_requests_approved_price_monthly_cents_check;

alter table public.enrollment_requests
  add constraint enrollment_requests_approved_price_monthly_cents_check
  check (approved_price_monthly_cents is null or approved_price_monthly_cents >= 0);

drop policy if exists "teachers and admins create returned enrollment notices" on public.enrollment_requests;
create policy "teachers and admins create returned enrollment notices"
on public.enrollment_requests for insert
with check (
  status in ('cancelled', 'rejected', 'waitlisted')
  and public.can_manage_program(program_id)
);
