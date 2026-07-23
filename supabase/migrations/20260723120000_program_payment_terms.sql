create table if not exists public.program_payment_terms (
  id uuid primary key default gen_random_uuid(),
  mosque_id uuid not null references public.mosques(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  enrollment_request_id uuid references public.enrollment_requests(id) on delete set null,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  student_profile_id uuid not null references public.profiles(id) on delete cascade,
  parent_profile_id uuid references public.profiles(id) on delete set null,
  payment_type text not null,
  amount_cents integer,
  currency text not null default 'cad',
  billing_months integer,
  billing_start_behavior text not null default 'on_payment',
  billing_end_behavior text not null default 'not_applicable',
  program_start_date_snapshot date,
  program_end_date_snapshot date,
  status text not null default 'pending_confirmation',
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  stripe_subscription_schedule_id text,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  superseded_by_payment_terms_id uuid references public.program_payment_terms(id) on delete set null,
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.program_payment_terms
  drop constraint if exists program_payment_terms_payment_type_check,
  add constraint program_payment_terms_payment_type_check
  check (payment_type in ('free', 'waived', 'monthly', 'pay_in_full'));

alter table public.program_payment_terms
  drop constraint if exists program_payment_terms_amount_cents_check,
  add constraint program_payment_terms_amount_cents_check
  check (amount_cents is null or amount_cents >= 0);

alter table public.program_payment_terms
  drop constraint if exists program_payment_terms_billing_months_check,
  add constraint program_payment_terms_billing_months_check
  check (billing_months is null or billing_months > 0);

alter table public.program_payment_terms
  drop constraint if exists program_payment_terms_billing_start_behavior_check,
  add constraint program_payment_terms_billing_start_behavior_check
  check (billing_start_behavior in ('on_payment', 'program_start', 'not_applicable'));

alter table public.program_payment_terms
  drop constraint if exists program_payment_terms_billing_end_behavior_check,
  add constraint program_payment_terms_billing_end_behavior_check
  check (billing_end_behavior in ('fixed_month_count', 'ongoing_until_cancelled', 'not_applicable'));

alter table public.program_payment_terms
  drop constraint if exists program_payment_terms_status_check,
  add constraint program_payment_terms_status_check
  check (status in (
    'pending_confirmation',
    'payment_required',
    'checkout_pending',
    'active',
    'paid',
    'waived',
    'ended',
    'superseded',
    'cancelled',
    'failed',
    'past_due'
  ));

create unique index if not exists program_payment_terms_current_request_unique
  on public.program_payment_terms(enrollment_request_id)
  where enrollment_request_id is not null
    and status not in ('superseded', 'cancelled', 'ended');

create index if not exists program_payment_terms_program_student_idx
  on public.program_payment_terms(program_id, student_profile_id, created_at desc);

create index if not exists program_payment_terms_program_status_idx
  on public.program_payment_terms(program_id, status);

create unique index if not exists program_payment_terms_checkout_session_unique
  on public.program_payment_terms(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists program_payment_terms_subscription_unique
  on public.program_payment_terms(stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.enrollment_requests
  add column if not exists payment_terms_id uuid references public.program_payment_terms(id) on delete set null;

alter table public.program_subscriptions
  add column if not exists payment_terms_id uuid references public.program_payment_terms(id) on delete set null,
  add column if not exists stripe_subscription_schedule_id text,
  add column if not exists amount_cents integer,
  add column if not exists billing_months integer,
  add column if not exists currency text not null default 'cad';

alter table public.program_payments
  add column if not exists payment_terms_id uuid references public.program_payment_terms(id) on delete set null;

alter table public.program_payment_terms enable row level security;

drop policy if exists "students parents and finance managers view payment terms" on public.program_payment_terms;
create policy "students parents and finance managers view payment terms"
on public.program_payment_terms for select
using (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
  or public.can_manage_program_finances(program_id)
);

drop policy if exists "finance managers manage payment terms" on public.program_payment_terms;
create policy "finance managers manage payment terms"
on public.program_payment_terms for all
using (public.can_manage_program_finances(program_id))
with check (public.can_manage_program_finances(program_id));
