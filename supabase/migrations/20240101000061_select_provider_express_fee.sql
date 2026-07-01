-- ============================================================================
-- H3 fix + false-"Provider Unavailable"-alert fix.
--
-- Fold payment_method + is_express into select_provider_for_order and DERIVE
-- express_fee server-side from platform_settings.express_delivery_fee, instead
-- of trusting the express_fee the client wrote onto the order row. This closes
-- H3 (client could set any express_fee) and lets confirmSelection drop its
-- pre-RPC orders UPDATE — removing the intermediate awaiting_dealer_selection
-- event that spuriously tripped the customer's "Provider Unavailable" revert alert.
--
-- Adapted from the migration-052 definition. ONLY changes: two new params, the
-- server-derived v_express_fee, and three extra columns in the final UPDATE
-- (payment_method, is_express, express_fee). The total now uses v_express_fee,
-- NOT v_order.express_fee. Everything else (auth check, status guard, acceptance
-- check, per-item reprice with is_available + price>0 guards, the in_transit
-- transition) is identical.
--
-- Adding params changes the function's argument-type signature, so this is a NEW
-- function to Postgres, NOT a replace of the old 2-arg one. Drop the old 2-arg
-- version explicitly so there is a single canonical function and the old
-- client-trusting-express_fee overload can no longer be called.
-- ============================================================================

drop function if exists public.select_provider_for_order(uuid, uuid);

create or replace function public.select_provider_for_order(
  p_order_id uuid,
  p_provider_id uuid,
  p_payment_method text default 'cash',
  p_is_express boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       public.orders%rowtype;
  v_item        record;
  v_price       numeric(10,2);
  v_total       numeric(12,2) := 0;
  v_express_fee numeric(10,2);
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.customer_id <> auth.uid() then
    raise exception 'Not authorized for this order';
  end if;

  if v_order.status <> 'awaiting_dealer_selection'
     or v_order.selected_provider_id is not null then
    raise exception 'Order is not open for provider selection';
  end if;

  if not exists (
    select 1 from public.order_acceptances
    where order_id = p_order_id
      and provider_id = p_provider_id
      and withdrawn_at is null
  ) then
    raise exception 'Selected provider has not accepted this order';
  end if;

  -- Server-derived express fee (H3): trust the platform setting, not the client.
  v_express_fee := case
    when p_is_express then (select coalesce(express_delivery_fee, 0) from public.platform_settings where id = 1)
    else 0
  end;

  for v_item in
    select id, product_id, quantity from public.order_items
    where order_id = p_order_id
  loop
    -- Existence + price validation only (no stock check).
    select price into v_price
    from public.provider_products
    where provider_id = p_provider_id
      and product_id  = v_item.product_id
      and is_available = true;

    if v_price is null then
      raise exception 'Selected provider does not offer one of the ordered products';
    end if;
    if v_price <= 0 then
      raise exception 'Selected provider has not set a price for one of the ordered products';
    end if;

    update public.order_items
      set unit_price = v_price,
          subtotal   = v_price * v_item.quantity,
          provider_product_id = (
            select id from public.provider_products
            where provider_id = p_provider_id and product_id = v_item.product_id
          )
    where id = v_item.id;

    v_total := v_total + (v_price * v_item.quantity);
  end loop;

  update public.orders
    set selected_provider_id = p_provider_id,
        payment_method       = coalesce(p_payment_method, 'cash')::public.payment_method,
        is_express           = p_is_express,
        express_fee          = v_express_fee,
        total_amount         = v_total + v_express_fee,
        status               = 'in_transit'
  where id = p_order_id;
end;
$$;

grant execute on function public.select_provider_for_order(uuid, uuid, text, boolean) to authenticated;
