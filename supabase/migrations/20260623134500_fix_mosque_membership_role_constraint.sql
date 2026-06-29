alter table public.mosque_memberships
  drop constraint if exists mosque_memberships_role_check;

alter table public.mosque_memberships
  add constraint mosque_memberships_role_check
  check (role in ('student', 'parent', 'teacher', 'admin'));
