alter table public.enrollments
  add column if not exists status text not null default 'active'
  check (status in ('active', 'kicked', 'withdrawn'));

create index if not exists enrollments_program_status_idx
  on public.enrollments(program_id, status);

drop policy if exists "program teachers and admins update enrollments" on public.enrollments;
create policy "program teachers and admins update enrollments"
on public.enrollments for update
using (public.is_program_teacher(program_id))
with check (public.is_program_teacher(program_id));
