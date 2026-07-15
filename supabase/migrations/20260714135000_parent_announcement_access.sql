drop policy if exists "enrolled students and teachers view announcements" on public.program_announcements;
create policy "enrolled students parents and teachers view announcements"
on public.program_announcements for select
using (
  exists (
    select 1
    from public.enrollments e
    where e.program_id = program_announcements.program_id
      and (
        e.student_profile_id = auth.uid()
        or exists (
          select 1
          from public.parent_child_links pcl
          join public.programs p on p.id = e.program_id
          where pcl.parent_profile_id = auth.uid()
            and pcl.child_profile_id = e.student_profile_id
            and pcl.mosque_id = p.mosque_id
        )
      )
  )
  or public.is_program_teacher(program_id)
);

drop policy if exists "students view own enrollments and teachers view assigned enrollments" on public.enrollments;
create policy "students parents and teachers view relevant enrollments"
on public.enrollments for select
using (
  student_profile_id = auth.uid()
  or exists (
    select 1
    from public.parent_child_links pcl
    join public.programs p on p.id = enrollments.program_id
    where pcl.parent_profile_id = auth.uid()
      and pcl.child_profile_id = enrollments.student_profile_id
      and pcl.mosque_id = p.mosque_id
  )
  or public.is_program_teacher(program_id)
);

drop policy if exists "announcement receipts visible to owner" on public.program_announcement_receipts;
create policy "announcement receipts visible to owner and program teachers"
on public.program_announcement_receipts for select
using (
  profile_id = auth.uid()
  or exists (
    select 1
    from public.program_announcements pa
    where pa.id = program_announcement_receipts.announcement_id
      and public.is_program_teacher(pa.program_id)
  )
);
