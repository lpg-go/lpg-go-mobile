-- ============================================================================
-- Express Delivery
-- ============================================================================
--
-- WHAT
-- ----
-- Orders can opt into Express Delivery. An express order carries:
--   * orders.is_express   — the flag the customer set at checkout
--   * orders.express_fee  — the fee snapshotted onto the order at checkout
-- Admin configures the offer via platform_settings:
--   * express_enabled     — whether the option is shown to customers
--   * express_delivery_fee — the fee amount admins charge
--
-- MONEY MODEL
-- ----------
-- The express fee is FOLDED INTO orders.total_amount. The provider collects the
-- full total_amount as COD cash and keeps 100% of the express fee — there is no
-- platform cut on it and NO change to the delivery trigger / fee logic
-- (handle_order_delivered still deducts only the existing admin fee).
--
-- WHY THE RPC NEEDS A CHANGE
-- --------------------------
-- select_provider_for_order() RECOMPUTES total_amount from the per-item goods
-- subtotals when a provider is selected (it reprices each item against the
-- provider's live price). That recompute is goods-only and would OVERWRITE the
-- express fee that checkout baked into total_amount. So the RPC must add the
-- order's express_fee back onto the recomputed total. This is the ONLY change to
-- the function — the per-item repricing, the is_available / price>0 guards, the
-- listing-existence check, and the status transition are all preserved verbatim
-- from migration 044 (the current live definition; 047 only added a CHECK
-- constraint and did not redefine the function).
-- ============================================================================


-- ── 1. Order columns ────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_express boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS express_fee numeric(10,2) NOT NULL DEFAULT 0;


-- ── 2. Platform settings config ─────────────────────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS express_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS express_delivery_fee numeric(10,2) NOT NULL DEFAULT 0;


-- ── 3. select_provider_for_order(): preserve express fee through recompute ───
-- Identical to migration 044's definition except the orders.total_amount line,
-- which now adds back the order's express_fee so the goods-only recompute does
-- not discard it. Everything else (reprice, guards, status) is unchanged.
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
        total_amount = v_total + coalesce(v_order.express_fee, 0),
        status = 'in_transit'
  where id = p_order_id;
end;
$$;

grant execute on function public.select_provider_for_order(uuid, uuid) to authenticated;
