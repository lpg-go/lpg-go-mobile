-- Restrict express orders to riders.
-- Rewrites accept_order (base definition from migration 060) so that when an
-- order is express, only providers whose provider_type = 'rider' may accept it.
-- Dealers can still accept non-express orders exactly as before.

create or replace function public.accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status        public.order_status;
  v_is_express    boolean;
  v_provider_type text;
begin
  select status, is_express into v_status, v_is_express
    from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if not public.is_provider() then
    raise exception 'Not authorized';
  end if;
  if v_status not in ('pending', 'awaiting_dealer_selection') then
    raise exception 'Order is not open for acceptance';
  end if;

  -- Express orders can only be accepted by riders.
  if v_is_express then
    select provider_type into v_provider_type
      from public.profiles where id = auth.uid();
    if v_provider_type is distinct from 'rider' then
      raise exception 'Express orders can only be accepted by riders';
    end if;
  end if;

  insert into public.order_acceptances (order_id, provider_id)
    values (p_order_id, auth.uid())
    on conflict (order_id, provider_id)
    do update set withdrawn_at = null, accepted_at = now();

  if v_status = 'pending' then
    update public.orders
      set status = 'awaiting_dealer_selection'
      where id = p_order_id and status = 'pending';
  end if;
end;
$$;

grant execute on function public.accept_order(uuid) to authenticated;
