-- H1 (security audit): accept_order enforced the provider balance minimum only
-- in the client (app/(provider)/index.tsx:380). A provider calling the RPC
-- directly — or from a patched build — could accept orders with zero or negative
-- balance, defeating the prepaid-float model. Re-create accept_order (verbatim
-- from migration 073) and add a SERVER-SIDE balance gate that mirrors the client
-- check: lock the provider's profile row and reject if balance < min_balance.
-- The rest of accept_order is unchanged.

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
  v_balance       numeric;
  v_min_balance   numeric;
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

  -- H1: server-side balance gate (mirrors the client check that was the only
  -- guard before). Lock the caller's profile row so the read is consistent.
  select balance into v_balance
    from public.profiles where id = auth.uid() for update;
  select min_balance into v_min_balance
    from public.platform_settings where id = 1;
  if v_balance < coalesce(v_min_balance, 0) then
    raise exception 'Insufficient balance to accept orders';
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
