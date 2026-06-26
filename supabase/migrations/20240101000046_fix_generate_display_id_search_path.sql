-- Fix: nested trigger execution during auth signup couldn't resolve bare sequence names; schema-qualify + pin search_path.

create or replace function public.generate_display_id(
  p_role user_role,
  p_provider_type provider_type
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_prefix text;
  v_num bigint;
begin
  if p_role = 'customer' then
    v_prefix := 'CS';
    v_num := nextval('public.seq_display_id_customer');
  elsif p_role = 'provider' and p_provider_type = 'dealer' then
    v_prefix := 'DL';
    v_num := nextval('public.seq_display_id_dealer');
  elsif p_role = 'provider' and p_provider_type = 'rider' then
    v_prefix := 'RD';
    v_num := nextval('public.seq_display_id_rider');
  elsif p_role = 'admin' then
    v_prefix := 'AD';
    v_num := nextval('public.seq_display_id_admin');
  else
    return null;  -- provider rows with null provider_type (mid-signup) get no ID yet
  end if;
  return 'LG' || v_prefix || lpad(v_num::text, 5, '0');
end;
$$;
