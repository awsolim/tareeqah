create table if not exists public.program_student_notes (
  id uuid primary key default gen_random_uuid(),
  mosque_id uuid not null references public.mosques(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  student_profile_id uuid not null references public.profiles(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  parent_profile_id uuid references public.profiles(id) on delete set null,
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  category text not null default 'note',
  seen_at timestamptz,
  seen_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_student_notes_message_check check (length(trim(message)) > 0),
  constraint program_student_notes_category_check check (category in ('note', 'homework', 'feedback', 'progress'))
);

create index if not exists program_student_notes_program_student_idx
  on public.program_student_notes(program_id, student_profile_id, created_at desc);

create index if not exists program_student_notes_recipient_seen_idx
  on public.program_student_notes(recipient_profile_id, seen_at, created_at desc);

alter table public.program_student_notes enable row level security;

drop policy if exists "program teachers view student notes" on public.program_student_notes;
create policy "program teachers view student notes"
on public.program_student_notes for select
using (public.is_program_teacher(program_id));

drop policy if exists "student and parent view own program notes" on public.program_student_notes;
create policy "student and parent view own program notes"
on public.program_student_notes for select
using (
  recipient_profile_id = auth.uid()
  or student_profile_id = auth.uid()
  or (
    parent_profile_id = auth.uid()
    and public.is_parent_of_child(student_profile_id, auth.uid(), mosque_id)
  )
);

drop policy if exists "program teachers create student notes" on public.program_student_notes;
create policy "program teachers create student notes"
on public.program_student_notes for insert
with check (
  author_profile_id = auth.uid()
  and public.is_program_teacher(program_id)
  and (
    recipient_profile_id = student_profile_id
    or (
      parent_profile_id = recipient_profile_id
      and public.is_parent_of_child(student_profile_id, parent_profile_id, mosque_id)
    )
  )
  and exists (
    select 1
    from public.enrollments e
    where e.program_id = program_student_notes.program_id
      and e.student_profile_id = program_student_notes.student_profile_id
  )
);

create or replace function public.mark_program_student_notes_seen(note_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := auth.uid();
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.program_student_notes psn
  set seen_at = coalesce(psn.seen_at, now()),
      seen_by = coalesce(psn.seen_by, current_profile_id),
      updated_at = now()
  where psn.id = any(note_ids)
    and psn.seen_at is null
    and (
      psn.recipient_profile_id = current_profile_id
      or psn.student_profile_id = current_profile_id
      or (
        psn.parent_profile_id = current_profile_id
        and public.is_parent_of_child(psn.student_profile_id, current_profile_id, psn.mosque_id)
      )
    );
end;
$$;

grant execute on function public.mark_program_student_notes_seen(uuid[]) to authenticated;
