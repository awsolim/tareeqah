-- Program status model refinement (visibility / applications / timing / lifecycle).
-- Non-destructive: only adds allowed enum values and an additional restrictive
-- RLS policy. No columns or tables are dropped or renamed.

-- Lifecycle: add "paused" so staff can temporarily take a program off active
-- rotation (attendance/session creation pauses) without cancelling or archiving it.
alter table public.programs
  drop constraint if exists programs_lifecycle_status_check,
  add constraint programs_lifecycle_status_check
  check (lifecycle_status in ('upcoming', 'active', 'paused', 'completed', 'cancelled', 'archived'));

-- Applications: add "opens_later" as a first-class status so "applications open
-- on a future date" is a stored state rather than being inferred client-side.
alter table public.programs
  drop constraint if exists programs_application_status_check,
  add constraint programs_application_status_check
  check (application_status in ('accepting', 'not_accepting', 'opens_later', 'waitlist_only', 'closed', 'invite_only'));

-- RLS: the original select policy on public.programs (predates this migrations
-- folder) does not filter by status at all, so any anon/authenticated request can
-- currently read draft/archived program rows directly via the REST API. Fixed
-- with a RESTRICTIVE policy, which is AND-ed with whatever permissive policy
-- already exists, rather than a normal (OR-ed) permissive policy that would not
-- narrow anything. This mirrors the is_active convention already used by
-- program_tracks/program_details/program_media's own policies.
drop policy if exists "programs visibility restriction" on public.programs;
create policy "programs visibility restriction"
on public.programs as restrictive
for select
using (
  is_active = true
  or public.can_manage_program(id)
);
