alter table public.profiles enable row level security;

drop policy if exists "public can view active program teacher display profiles" on public.profiles;
create policy "public can view active program teacher display profiles"
on public.profiles for select
using (
  id = auth.uid()
  or exists (
    select 1
    from public.programs p
    where p.teacher_profile_id = profiles.id
      and p.is_active = true
  )
);
