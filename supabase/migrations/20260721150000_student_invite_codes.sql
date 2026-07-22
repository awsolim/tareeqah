-- Student self-service invite codes, mirroring the existing instructor invite-code flow
-- (program_teachers.invite_code / lookup_program_instructor_code / claim_program_instructor_code)
-- but for students — mainly for private/invite-only classes, or inviting a specific
-- student into an application-required class without going through the normal apply flow.
-- Unlike instructor codes (an unclaimed program_teachers row IS the code), enrollment_requests
-- has no natural "unclaimed slot" shape, so this gets its own table.
create table if not exists public.program_student_invites (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  invite_code text not null,
  invite_code_created_at timestamptz not null default now(),
  comment text,
  payment_bypassed boolean not null default false,
  payment_bypass_external boolean not null default false,
  payment_type text not null default 'monthly',
  custom_price_monthly_cents integer,
  custom_price_annual_cents integer,
  claimed_by_profile_id uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.program_student_invites
  drop constraint if exists program_student_invites_payment_type_check,
  add constraint program_student_invites_payment_type_check
  check (payment_type in ('monthly', 'annual'));

create unique index if not exists program_student_invites_code_unique
  on public.program_student_invites(invite_code);

create index if not exists program_student_invites_program_idx
  on public.program_student_invites(program_id);

alter table public.program_student_invites enable row level security;

drop policy if exists "program managers manage student invites" on public.program_student_invites;
create policy "program managers manage student invites"
on public.program_student_invites for all
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

create or replace function public.lookup_program_student_invite_code(invite text)
returns table (
  program_id uuid,
  title text,
  director_name text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  current_profile_id uuid := auth.uid();
  normalized_invite text := upper(trim(invite));
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    p.id as program_id,
    p.title,
    coalesce(director.full_name, director.email, 'Program director') as director_name
  from public.program_student_invites psi
  join public.programs p on p.id = psi.program_id
  left join public.profiles director on director.id = coalesce(p.director_profile_id, p.teacher_profile_id)
  where psi.invite_code = normalized_invite
    and psi.claimed_at is null
  limit 1;
end;
$$;

grant execute on function public.lookup_program_student_invite_code(text) to authenticated;

create or replace function public.claim_program_student_invite_code(
  invite text,
  target_student_profile_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := auth.uid();
  normalized_invite text := upper(trim(invite));
  inv public.program_student_invites%rowtype;
  target_mosque_id uuid;
  program_monthly_cents integer;
  program_annual_cents integer;
  result_request_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  if target_student_profile_id <> current_profile_id and not exists (
    select 1 from public.parent_child_links pcl
    where pcl.parent_profile_id = current_profile_id
      and pcl.child_profile_id = target_student_profile_id
  ) then
    raise exception 'Not authorized to register this student';
  end if;

  select psi.* into inv
  from public.program_student_invites psi
  where psi.invite_code = normalized_invite
    and psi.claimed_at is null
  limit 1;

  if inv.id is null then
    raise exception 'Invalid or already used registration code';
  end if;

  select p.mosque_id, p.price_monthly_cents, p.price_annual_cents
  into target_mosque_id, program_monthly_cents, program_annual_cents
  from public.programs p
  where p.id = inv.program_id;

  insert into public.enrollment_requests (
    mosque_id, program_id, student_profile_id, parent_profile_id,
    status, requested_at, reviewed_by, reviewed_at, review_note, decision_note,
    payment_type, approved_price_monthly_cents, approved_price_annual_cents,
    payment_bypassed, payment_bypass_external
  )
  values (
    target_mosque_id, inv.program_id, target_student_profile_id,
    case when target_student_profile_id <> current_profile_id then current_profile_id else null end,
    'approved', now(), inv.created_by, now(), inv.comment, inv.comment,
    inv.payment_type,
    case
      when inv.payment_bypassed then 0
      when inv.payment_type = 'monthly' then coalesce(inv.custom_price_monthly_cents, program_monthly_cents)
      else null
    end,
    case
      when inv.payment_bypassed then 0
      when inv.payment_type = 'annual' then coalesce(inv.custom_price_annual_cents, program_annual_cents)
      else null
    end,
    inv.payment_bypassed, inv.payment_bypass_external
  )
  on conflict (program_id, student_profile_id)
  do update set
    status = 'approved',
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_note = excluded.review_note,
    decision_note = excluded.decision_note,
    payment_type = excluded.payment_type,
    approved_price_monthly_cents = excluded.approved_price_monthly_cents,
    approved_price_annual_cents = excluded.approved_price_annual_cents,
    payment_bypassed = excluded.payment_bypassed,
    payment_bypass_external = excluded.payment_bypass_external,
    admission_completed_at = null,
    teacher_dismissed_at = null
  returning id into result_request_id;

  update public.program_student_invites
  set claimed_by_profile_id = target_student_profile_id, claimed_at = now()
  where id = inv.id;

  return result_request_id;
end;
$$;

grant execute on function public.claim_program_student_invite_code(text, uuid) to authenticated;
