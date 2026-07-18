-- Tracks Stripe's pause_collection state locally so the finance page can show
-- "Paused" without an extra live Stripe call per row. Kept in sync by the
-- Stripe webhook (customer.subscription.updated) the same way status and
-- cancel_at_period_end already are.
alter table public.program_subscriptions
  add column if not exists payment_paused boolean not null default false;

alter table public.program_subscriptions
  add column if not exists payment_paused_until timestamptz null;
