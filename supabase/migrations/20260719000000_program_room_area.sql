-- A distinct "Room / Area" concept (e.g. "Room 204", "Main Hall"), separate from
-- `room`, which is already in active use as the second line of the class's
-- street address (labeled "Location address" in the builder).
alter table public.programs
  add column if not exists room_area text;
