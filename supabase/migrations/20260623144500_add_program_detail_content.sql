create extension if not exists pgcrypto;

create table if not exists public.program_details (
  program_id uuid primary key references public.programs(id) on delete cascade,
  learning_intro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_outcomes (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  sort_order integer not null default 0,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, sort_order)
);

create table if not exists public.program_content_sections (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  sort_order integer not null default 0,
  title text not null,
  description text,
  duration_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, sort_order)
);

create table if not exists public.program_media (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  sort_order integer not null default 0,
  media_type text not null default 'photo' check (media_type in ('photo', 'video')),
  url text not null,
  thumbnail_url text,
  title text,
  short_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, sort_order)
);

create index if not exists program_outcomes_program_idx on public.program_outcomes(program_id, sort_order);
create index if not exists program_content_sections_program_idx on public.program_content_sections(program_id, sort_order);
create index if not exists program_media_program_idx on public.program_media(program_id, sort_order);

alter table public.program_details enable row level security;
alter table public.program_outcomes enable row level security;
alter table public.program_content_sections enable row level security;
alter table public.program_media enable row level security;

drop policy if exists "public can view active program details" on public.program_details;
create policy "public can view active program details"
on public.program_details for select
using (
  exists (
    select 1
    from public.programs p
    where p.id = program_details.program_id
      and p.is_active = true
  )
);

drop policy if exists "public can view active program outcomes" on public.program_outcomes;
create policy "public can view active program outcomes"
on public.program_outcomes for select
using (
  exists (
    select 1
    from public.programs p
    where p.id = program_outcomes.program_id
      and p.is_active = true
  )
);

drop policy if exists "public can view active program content sections" on public.program_content_sections;
create policy "public can view active program content sections"
on public.program_content_sections for select
using (
  exists (
    select 1
    from public.programs p
    where p.id = program_content_sections.program_id
      and p.is_active = true
  )
);

drop policy if exists "public can view active program media" on public.program_media;
create policy "public can view active program media"
on public.program_media for select
using (
  exists (
    select 1
    from public.programs p
    where p.id = program_media.program_id
      and p.is_active = true
  )
);

drop policy if exists "teachers and admins manage program details" on public.program_details;
create policy "teachers and admins manage program details"
on public.program_details for all
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

drop policy if exists "teachers and admins manage program outcomes" on public.program_outcomes;
create policy "teachers and admins manage program outcomes"
on public.program_outcomes for all
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

drop policy if exists "teachers and admins manage program content sections" on public.program_content_sections;
create policy "teachers and admins manage program content sections"
on public.program_content_sections for all
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

drop policy if exists "teachers and admins manage program media" on public.program_media;
create policy "teachers and admins manage program media"
on public.program_media for all
using (public.can_manage_program(program_id))
with check (public.can_manage_program(program_id));

insert into public.program_details (program_id, learning_intro)
select
  p.id,
  'This ' || p.title || ' track gives students a structured path with practical lessons, review time, and teacher feedback. Program-specific outcomes can be expanded once the full curriculum details are added.'
from public.programs p
on conflict (program_id) do nothing;

insert into public.program_outcomes (program_id, sort_order, text)
select p.id, v.sort_order, replace(v.text_template, '{title}', p.title)
from public.programs p
cross join (
  values
    (1, 'Build confidence with the foundations of {title}'),
    (2, 'Follow a clear weekly learning rhythm'),
    (3, 'Practice with teacher guidance and feedback'),
    (4, 'Understand expectations before joining the class')
) as v(sort_order, text_template)
on conflict (program_id, sort_order) do nothing;

insert into public.program_content_sections (program_id, sort_order, title, description, duration_text)
select p.id, v.sort_order, v.title, replace(v.description_template, '{title}', p.title), v.duration_text
from public.programs p
cross join (
  values
    (1, 'Program Orientation', 'Overview of {title} goals and class expectations', '20 min'),
    (2, 'Core Foundations', 'Main lessons, guided examples, and practice routines', '45 min'),
    (3, 'Review and Reinforcement', 'Student check-ins, revision, and home practice guidance', '30 min'),
    (4, 'Progress Path', 'How students move through the class and prepare for the next step', '25 min')
) as v(sort_order, title, description_template, duration_text)
on conflict (program_id, sort_order) do nothing;

insert into public.program_media (program_id, sort_order, media_type, url, thumbnail_url, title, short_label)
select p.id, v.sort_order, v.media_type, v.url, v.url, replace(v.title_template, '{title}', p.title), v.short_label
from public.programs p
cross join (
  values
    (1, 'photo', '/assiddiq1.jpeg', '{title} classroom setting', 'Classroom'),
    (2, 'photo', '/assiddiq2.jpeg', 'Student work and materials', 'Materials'),
    (3, 'video', '/assiddiq3.jpeg', 'Course preview video', 'Preview'),
    (4, 'photo', '/assiddiq4.jpeg', 'Community learning environment', 'Community')
) as v(sort_order, media_type, url, title_template, short_label)
on conflict (program_id, sort_order) do nothing;
