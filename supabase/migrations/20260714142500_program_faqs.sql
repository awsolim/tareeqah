create table if not exists public.program_faqs (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  sort_order integer not null default 0,
  question text not null,
  answer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, sort_order)
);

create index if not exists program_faqs_program_idx on public.program_faqs(program_id, sort_order);

alter table public.program_faqs enable row level security;

drop policy if exists "public can view active program faqs" on public.program_faqs;
create policy "public can view active program faqs"
on public.program_faqs for select
using (
  exists (
    select 1
    from public.programs p
    where p.id = program_faqs.program_id
      and p.is_active = true
  )
);

drop policy if exists "teachers and admins manage program faqs" on public.program_faqs;
create policy "teachers and admins manage program faqs"
on public.program_faqs for all
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

insert into public.program_faqs (program_id, sort_order, question, answer)
select p.id, v.sort_order, v.question, replace(v.answer_template, '{title}', p.title)
from public.programs p
cross join (
  values
    (1, 'Who can join this class?', '{title} is open to students who match the listed age and audience requirements. If you are unsure, submit an application and the teaching team will review it.'),
    (2, 'What should students bring?', 'Students should bring their regular learning materials, a notebook, and anything requested by the instructor after enrollment.'),
    (3, 'How do schedule choices work?', 'If this class has multiple schedules, choose the schedule that works best when applying. Enrolled families can manage eligible schedule changes from the class page.')
) as v(sort_order, question, answer_template)
on conflict (program_id, sort_order) do nothing;
