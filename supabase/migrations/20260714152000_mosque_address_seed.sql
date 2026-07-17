alter table public.mosques
  add column if not exists address text;

update public.mosques
set address = '5525 Gateway Blvd NW, Edmonton, AB T6H 2H3',
    updated_at = now()
where slug = 'assiddiq'
  and (address is null or trim(address) = '');
