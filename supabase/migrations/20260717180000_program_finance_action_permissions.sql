-- Permission check for the finance actions (waive/change price/end subscription)
-- being wired up server-side. The client already computes "admin OR
-- finance-enabled director" before showing these actions, but that check only
-- ever ran in the browser — nothing server-side enforced it before a Stripe
-- call. This mirrors can_manage_program's existing pattern so the new finance
-- API routes have a single source of truth to call via RPC.
create or replace function public.can_manage_program_finances(
  check_program_id uuid,
  check_profile_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.programs p
    where p.id = check_program_id
      and public.has_mosque_role(p.mosque_id, array['admin'], check_profile_id)
  )
  or exists (
    select 1
    from public.program_teachers pt
    where pt.program_id = check_program_id
      and pt.teacher_profile_id = check_profile_id
      and pt.role = 'director'
      and pt.can_manage_finances = true
  );
$$;
