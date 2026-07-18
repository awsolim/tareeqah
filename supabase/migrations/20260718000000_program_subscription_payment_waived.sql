-- Tracks a Director/Admin's decision to waive a student's future billing
-- going forward (Manage Finances "Waive Future Payments" action). Kept
-- separate from `status`/`payment_paused` because both of those are actively
-- synced from real Stripe state by the webhook's customer.subscription.updated
-- handler and would get clobbered on the next sync; this column set is never
-- written by that handler, so it survives.
alter table public.program_subscriptions
  add column if not exists payment_waived boolean not null default false;

alter table public.program_subscriptions
  add column if not exists payment_waived_reason text;

alter table public.program_subscriptions
  add column if not exists payment_waived_at timestamptz;
