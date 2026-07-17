alter table public.programs
  add column if not exists cover_price_label_enabled boolean not null default true,
  add column if not exists cover_price_label text;
