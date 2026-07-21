-- Per-charge payment records. Previously the only record of a payment was a live
-- Stripe charges.list() call made on every finance-drawer open (nothing stored), plus
-- an opaque amountPaidCents buried in program_finance_audit_events.metadata. This table
-- promotes that into a durable, queryable record backing: parent-facing billing
-- history, admin payment history, CSV export, and tax-receipt eligibility/status.
create table if not exists public.program_payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.program_payments
  add column if not exists mosque_id uuid references public.mosques(id) on delete cascade,
  add column if not exists program_id uuid references public.programs(id) on delete cascade,
  add column if not exists program_subscription_id uuid references public.program_subscriptions(id) on delete set null,
  add column if not exists student_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists parent_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_invoice_id text,
  add column if not exists amount_cents integer not null default 0,
  add column if not exists currency text not null default 'cad',
  add column if not exists paid_at timestamptz not null default now(),
  add column if not exists receipt_url text,
  add column if not exists tax_receipt_status text not null default 'not_applicable',
  add column if not exists tax_receipt_eligible_amount_cents integer,
  add column if not exists tax_receipt_number text,
  add column if not exists tax_receipt_issued_at timestamptz,
  add column if not exists tax_receipt_issued_by uuid references public.profiles(id) on delete set null,
  add column if not exists tax_receipt_note text;

alter table public.program_payments
  drop constraint if exists program_payments_tax_receipt_status_check,
  add constraint program_payments_tax_receipt_status_check
  check (tax_receipt_status in (
    'not_applicable',
    'admin_review_required',
    'eligible_pending_issue',
    'issued',
    'partial_issued',
    'not_eligible',
    'contact_admin'
  ));

-- Plain (non-partial) unique indexes: Postgres allows any number of NULL rows under a
-- standard unique constraint, so one-time-payment rows (charge id, no invoice id) and
-- recurring-invoice rows (invoice id, no charge id) coexist without needing partial
-- WHERE-clause indexes, and supabase-js upsert(..., { onConflict }) can target them directly.
create unique index if not exists program_payments_stripe_charge_unique
  on public.program_payments(stripe_charge_id);

create unique index if not exists program_payments_stripe_invoice_unique
  on public.program_payments(stripe_invoice_id);

create index if not exists program_payments_student_idx
  on public.program_payments(student_profile_id, paid_at desc);

create index if not exists program_payments_parent_idx
  on public.program_payments(parent_profile_id, paid_at desc);

create index if not exists program_payments_program_idx
  on public.program_payments(program_id, paid_at desc);

alter table public.program_payments enable row level security;

drop policy if exists "students and parents view own payments" on public.program_payments;
create policy "students and parents view own payments"
on public.program_payments for select
using (
  student_profile_id = auth.uid()
  or parent_profile_id = auth.uid()
);

drop policy if exists "finance managers view program payments" on public.program_payments;
create policy "finance managers view program payments"
on public.program_payments for select
using (public.can_manage_program_finances(program_id));

drop policy if exists "finance managers update tax receipt fields" on public.program_payments;
create policy "finance managers update tax receipt fields"
on public.program_payments for update
using (public.can_manage_program_finances(program_id))
with check (public.can_manage_program_finances(program_id));

-- Tax receipt policy is declared per-program (not assumed for every paid registration).
-- It only sets the *default* tax_receipt_status stamped onto new program_payments rows
-- for that program; the existing free-text receipt_note field stays as the
-- director-authored disclaimer shown to parents regardless of this setting.
alter table public.programs
  add column if not exists tax_receipt_policy text not null default 'not_applicable';

alter table public.programs
  drop constraint if exists programs_tax_receipt_policy_check,
  add constraint programs_tax_receipt_policy_check
  check (tax_receipt_policy in ('not_applicable', 'admin_review_required', 'eligible_confirmed'));
