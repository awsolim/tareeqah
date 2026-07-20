-- Durable, per-account notification "seen"/"dismissed" state for the teacher Inbox
-- (applications, withdrawals, instructors), replacing the previous localStorage-only
-- tracking, which couldn't follow an account across browsers/devices and had cap-eviction
-- bugs. One generic table for all three notification categories: `notification_key` reuses
-- the exact composed strings already produced client-side (teacherRequestNotificationKey /
-- teacherInstructorNotificationKey / studentWithdrawalNotificationKey). A row with only
-- seen_at set means "viewed, not yet cleared"; with both set means "cleared/dismissed".
create table if not exists public.teacher_notification_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_key text not null,
  seen_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, notification_key)
);

alter table public.teacher_notification_state enable row level security;

create index if not exists teacher_notification_state_user_id_idx
  on public.teacher_notification_state(user_id);

drop policy if exists "users manage their own notification state" on public.teacher_notification_state;
create policy "users manage their own notification state"
on public.teacher_notification_state for all
using (user_id = auth.uid())
with check (user_id = auth.uid());
