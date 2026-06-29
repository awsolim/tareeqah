create extension if not exists pgcrypto;

create table if not exists public.program_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.program_subscriptions
  add column if not exists mosque_id uuid references public.mosques(id) on delete cascade,
  add column if not exists program_id uuid references public.programs(id) on delete cascade,
  add column if not exists student_profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists parent_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists enrollment_request_id uuid references public.enrollment_requests(id) on delete set null,
  add column if not exists stripe_account_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_price_id text,
  add column if not exists status text not null default 'checkout_started',
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;

create unique index if not exists program_subscriptions_program_student_unique
  on public.program_subscriptions(program_id, student_profile_id)
  where program_id is not null and student_profile_id is not null;

create unique index if not exists program_subscriptions_program_student_conflict_idx
  on public.program_subscriptions(program_id, student_profile_id);

create unique index if not exists program_subscriptions_stripe_subscription_unique
  on public.program_subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index if not exists program_subscriptions_checkout_session_unique
  on public.program_subscriptions(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create index if not exists program_subscriptions_student_idx
  on public.program_subscriptions(student_profile_id, status);

create index if not exists program_subscriptions_program_idx
  on public.program_subscriptions(program_id, status);

alter table public.program_subscriptions enable row level security;

drop policy if exists "students parents and teachers view program subscriptions" on public.program_subscriptions;
create policy "students parents and teachers view program subscriptions"
on public.program_subscriptions for select
using (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
  or public.is_program_teacher(program_id)
);
