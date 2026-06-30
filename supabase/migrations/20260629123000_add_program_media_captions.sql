alter table public.program_media
  add column if not exists caption text,
  add column if not exists alt_text text,
  add column if not exists is_featured boolean not null default false;

update public.program_media
set
  caption = coalesce(caption, 'A look inside the weekly class environment.'),
  alt_text = coalesce(alt_text, title)
where caption is null
  or alt_text is null;

update public.program_media
set is_featured = sort_order = 1
where is_featured is false;
