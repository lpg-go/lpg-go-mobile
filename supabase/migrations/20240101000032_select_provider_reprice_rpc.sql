-- Reconcile order pricing to the selected provider, server-side and atomic.
create or replace function public.select_provider_for_order(
  p_order_id uuid,
  p_provider_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders%rowtype;
  v_item    record;
  v_price   numeric(10,2);
  v_stock   integer;
  v_total   numeric(12,2) := 0;
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

  for v_item in
    select id, product_id, quantity from public.order_items
    where order_id = p_order_id
  loop
    select price, stock into v_price, v_stock
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
    if v_stock is null or v_stock < v_item.quantity then
      raise exception 'Selected provider has insufficient stock for one of the ordered products';
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
        total_amount = v_total,
        status = 'in_transit'
  where id = p_order_id;
end;
$$;

grant execute on function public.select_provider_for_order(uuid, uuid) to authenticated;
