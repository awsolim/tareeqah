-- Web push subscriptions, one row per device/browser registration. `endpoint` is globally
-- unique per registration, so re-subscribing from the same device updates the existing row
-- (keys can change) instead of creating a duplicate.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create index if not exists push_subscriptions_profile_id_idx
  on public.push_subscriptions(profile_id);

drop policy if exists "users manage their own push subscriptions" on public.push_subscriptions;
create policy "users manage their own push subscriptions"
on public.push_subscriptions for all
using (profile_id = auth.uid())
with check (profile_id = auth.uid());
