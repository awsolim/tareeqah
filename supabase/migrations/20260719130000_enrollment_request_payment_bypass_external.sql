-- Distinguishes a genuine payment waiver (no money collected) from a bypassed
-- payment that was actually collected outside Tareeqah (cash, Zelle, etc.), so the
-- existing "Bypass payment" / "Waive Payment" actions can record which one happened
-- instead of always showing as "Waived". Replaces the program-level "manual" pricing
-- kind, which flagged an entire program as externally-paid instead of deciding this
-- per application.
alter table public.enrollment_requests
  add column if not exists payment_bypass_external boolean not null default false;
