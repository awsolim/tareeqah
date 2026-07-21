-- Durable, server-only diagnostic log for failures that would otherwise be silently
-- swallowed (e.g. a Stripe webhook handler throwing after a real payment event). RLS is
-- enabled with no policies at all — this table has zero end-user relevance, so only the
-- service-role key (used server-side) can read or write it.
create table if not exists public.system_error_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  message text not null,
  context jsonb,
  created_at timestamptz not null default now()
);

alter table public.system_error_logs enable row level security;

create index if not exists system_error_logs_created_at_idx
  on public.system_error_logs(created_at desc);
