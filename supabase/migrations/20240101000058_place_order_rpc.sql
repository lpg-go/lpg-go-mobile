-- C7 fix: replace client-side order creation with a SECURITY DEFINER RPC so the
-- client can no longer set its own total_amount / admin_fee / unit_price / subtotal /
-- status / expires_at. The client passes only product_id, quantity, the delivery
-- location, and payment_method; everything money/state is derived server-side here.
--
-- Single item per order (matches today's find-store flow exactly — the only order
-- creation path in the app). order + order_items + the awaiting_dealer_selection
-- status are all written in one transaction, so there is no half-created/orphan
-- window and no need for the client-side cleanup DELETE.
--
-- Status is inserted directly as 'awaiting_dealer_selection': no DB trigger depends
-- on a pending->awaiting_dealer_selection UPDATE (the only orders triggers are the
-- delivered-fee, delivery-time, updated_at, and display_id triggers — none key off
-- this transition). The provider "new order" broadcast is a client-side HTTP call to
-- the order-notifications Edge Function made after this RPC returns, not a DB trigger,
-- so it is unaffected. Provider visibility (RLS read policies + the incoming-orders
-- query) already includes 'awaiting_dealer_selection'.

create or replace function public.place_order(
  p_product_id      uuid,
  p_quantity        integer,
  p_delivery_address text,
  p_delivery_lat    double precision,
  p_delivery_lng    double precision,
  p_payment_method  text default 'cash'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer            uuid;
  v_max_active          integer;
  v_active_count        integer;
  v_unit_price          numeric(10, 2);
  v_provider_product_id uuid;
  v_admin_fee_unit      numeric(10, 2);
  v_admin_fee           numeric(10, 2);
  v_subtotal            numeric(10, 2);
  v_total               numeric(10, 2);
  v_expiry_minutes      integer;
  v_expires_at          timestamptz;
  v_order_id            uuid;
begin
  -- 1. Caller identity (RLS is bypassed inside SECURITY DEFINER, so derive trust here).
  v_customer := auth.uid();
  if v_customer is null then
    raise exception 'Not authenticated';
  end if;

  -- 2. Validate quantity.
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  -- 3. Enforce max active orders (closes H4 — was UI-only). Serialize per-customer
  --    so two concurrent placements can't both pass the count check (TOCTOU).
  perform pg_advisory_xact_lock(hashtext(v_customer::text));

  select coalesce(max_active_orders_per_customer, 0)
    into v_max_active
    from public.platform_settings
   where id = 1;

  -- Mirror the client: 0 (or null) means unlimited.
  if coalesce(v_max_active, 0) > 0 then
    select count(*)
      into v_active_count
      from public.orders
     where customer_id = v_customer
       and status in ('pending', 'awaiting_dealer_selection', 'in_transit', 'awaiting_confirmation');

    if v_active_count >= v_max_active then
      raise exception 'Too many active orders';
    end if;
  end if;

  -- 4. Derive unit_price + provider_product_id from the cheapest available provider
  --    (same filter the brand screen uses to pick the price shown to the customer).
  select pp.price, pp.id
    into v_unit_price, v_provider_product_id
    from public.provider_products pp
    join public.profiles pr on pr.id = pp.provider_id
   where pp.product_id   = p_product_id
     and pp.is_available  = true
     and pp.price         > 0
     and pr.is_online     = true
     and pr.is_approved   = true
   order by pp.price asc
   limit 1;

  if v_provider_product_id is null then
    raise exception 'No available providers for this product';
  end if;

  -- 5. Admin fee is a per-product field x quantity.
  select admin_fee
    into v_admin_fee_unit
    from public.products
   where id = p_product_id;

  if v_admin_fee_unit is null then
    raise exception 'Product not found';
  end if;

  v_admin_fee := v_admin_fee_unit * p_quantity;

  -- 6. Money totals (single item: total == subtotal at creation; express fee, if any,
  --    is added later at provider selection).
  v_subtotal := v_unit_price * p_quantity;
  v_total    := v_subtotal;

  -- 7. Expiry from platform_settings (mirror client default 10; 0 => never expire => null).
  select coalesce(order_expiry_minutes, 10)
    into v_expiry_minutes
    from public.platform_settings
   where id = 1;

  v_expiry_minutes := coalesce(v_expiry_minutes, 10);
  v_expires_at := case
                    when v_expiry_minutes > 0
                    then now() + (v_expiry_minutes * interval '1 minute')
                    else null
                  end;

  -- 8. Create the order directly in the broadcast state (atomic with items below).
  insert into public.orders (
    customer_id,
    status,
    delivery_address,
    delivery_lat,
    delivery_lng,
    total_amount,
    admin_fee,
    expires_at,
    payment_method
  )
  values (
    v_customer,
    'awaiting_dealer_selection',
    p_delivery_address,
    p_delivery_lat,
    p_delivery_lng,
    v_total,
    v_admin_fee,
    v_expires_at,
    -- orders.payment_method is the public.payment_method enum, so the text arg
    -- must be cast explicitly (a text expression won't implicitly coerce to enum).
    coalesce(p_payment_method, 'cash')::payment_method
  )
  returning id into v_order_id;

  -- 9. The single order item, priced server-side.
  insert into public.order_items (
    order_id,
    product_id,
    provider_product_id,
    quantity,
    unit_price,
    subtotal
  )
  values (
    v_order_id,
    p_product_id,
    v_provider_product_id,
    p_quantity,
    v_unit_price,
    v_subtotal
  );

  -- 10. Return the new order id.
  return v_order_id;
end;
$$;

grant execute on function public.place_order(uuid, integer, text, double precision, double precision, text) to authenticated;
