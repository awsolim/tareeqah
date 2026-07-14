alter table public.program_details
  add column if not exists instructor_contact_phone text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'program_details'
      and column_name = 'instructor_contact_url'
  ) then
    execute '
      update public.program_details
      set instructor_contact_phone = coalesce(instructor_contact_phone, instructor_contact_url)
      where instructor_contact_phone is null
        and instructor_contact_url is not null
    ';
  end if;
end $$;
