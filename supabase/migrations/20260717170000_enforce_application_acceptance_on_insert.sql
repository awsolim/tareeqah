-- Enrollment requests are inserted directly from the browser (see requestEnrollment
-- in the public program page), subject only to the identity-check policy
-- ("students and parents create enrollment requests" — checks who is submitting,
-- not whether the program is actually accepting applications). That means a
-- direct API call could submit an application to a draft, archived, cancelled,
-- or explicitly closed program today, bypassing the client-side UI gate entirely.
--
-- Fixed the same way as the earlier programs-table gap: an additive RESTRICTIVE
-- policy, which is AND-ed with the existing permissive insert policy rather than
-- replacing it. Staff-initiated rows (teachers/admins recording a cancelled,
-- rejected, or waitlisted decision — see "teachers and admins create returned
-- enrollment notices") are exempted via can_manage_program.
drop policy if exists "enrollment requests require an accepting program" on public.enrollment_requests;
create policy "enrollment requests require an accepting program"
on public.enrollment_requests as restrictive
for insert
with check (
  public.can_manage_program(program_id)
  or exists (
    select 1
    from public.programs p
    where p.id = enrollment_requests.program_id
      and p.publication_status not in ('draft', 'archived')
      and p.lifecycle_status not in ('completed', 'cancelled', 'archived')
      and p.application_status in ('accepting', 'waitlist_only')
      and (p.application_open_at is null or p.application_open_at <= now())
      and (p.application_close_at is null or p.application_close_at >= now())
  )
);
