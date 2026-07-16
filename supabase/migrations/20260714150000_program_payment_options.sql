alter table public.programs
  add column if not exists offers_monthly_payment boolean not null default true,
  add column if not exists offers_annual_payment boolean not null default false,
  add column if not exists price_annual_cents integer,
  add column if not exists stripe_annual_price_id text;

alter table public.programs
  drop constraint if exists programs_price_annual_cents_check;

alter table public.programs
  add constraint programs_price_annual_cents_check
  check (price_annual_cents is null or price_annual_cents >= 0);

update public.programs
set offers_monthly_payment = true
where is_paid = true
  and offers_monthly_payment = false
  and offers_annual_payment = false;

update public.programs
set offers_monthly_payment = false,
    offers_annual_payment = false,
    price_annual_cents = null
where is_paid = false;

alter table public.enrollment_requests
  add column if not exists payment_type text not null default 'monthly',
  add column if not exists approved_price_annual_cents integer;

alter table public.enrollment_requests
  drop constraint if exists enrollment_requests_payment_type_check,
  drop constraint if exists enrollment_requests_approved_price_annual_cents_check;

alter table public.enrollment_requests
  add constraint enrollment_requests_payment_type_check
  check (payment_type in ('monthly', 'annual')),
  add constraint enrollment_requests_approved_price_annual_cents_check
  check (approved_price_annual_cents is null or approved_price_annual_cents >= 0);

alter table public.program_subscriptions
  add column if not exists payment_type text not null default 'monthly';

alter table public.program_subscriptions
  drop constraint if exists program_subscriptions_payment_type_check;

alter table public.program_subscriptions
  add constraint program_subscriptions_payment_type_check
  check (payment_type in ('monthly', 'annual'));
