-- ============================================================================
-- Phase C #1 — Remove stock tracking; use is_available as the selling signal
-- ============================================================================
--
-- WHY
-- ---
-- The product model carried a per-provider `stock integer` on
-- provider_products that did triple duty: (a) order-routing filter
-- (.gt('stock', 0)), (b) customer availability ("Unavailable" overlays), and
-- (c) the low-stock alert trigger. Maintaining accurate counts was friction
-- for providers and added no real value for an LPG resale model where a
-- provider either sells a SKU or doesn't. We replace the numeric stock signal
-- with the existing boolean `provider_products.is_available`: a provider
-- opts in to selling a product (is_available = true, price > 0) rather than
-- maintaining a count.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--   1. Backfills is_available from the current stock value (preserve cutover
--      behavior: only currently-stocked listings stay available).
--   2. Updates select_provider_for_order() to drop the stock >= quantity
--      validation while keeping reprice + listing-existence + price checks.
--   3. Updates the three auto-assign functions to stop writing `stock` and to
--      seed new listings as is_available = false (provider must opt in).
--   4. Drops the stock-deduction RPC deduct_provider_stock().
--   5. Drops the provider_products.stock column.
--   6. Marks platform_settings.min_stock_level deprecated (kept for now; the
--      admin Settings UI still references it — removed in a later cleanup pass).
--
-- NOT TOUCHED (verified):
--   * handle_order_delivered() / trigger on_order_delivered — as of migration
--     0024 this function only deducts the admin fee from provider balance and
--     logs a transaction. It contains NO stock logic, so it is left intact.
--   * provider_products RLS policies — they key on is_available, never stock,
--     so "public read where is_available = true (or own/admin)" is already in
--     place. No policy change required.
--
-- ⚠️ DEPLOYMENT ORDERING
-- ----------------------
-- Dropping the stock column and deduct_provider_stock() will break, until the
-- Phase 2 app/edge changes ship:
--   * order-notifications edge fn — calls rpc('deduct_provider_stock') on
--     delivery_confirmed and filters recipients with .gt('stock', 0)
--   * client queries filtering provider_products on .gt('stock', 0)
-- Ship this migration together with the Phase 2 edge-function + client update.
-- ============================================================================


-- ── 1. Backfill is_available from current stock AND price ───────────────────
-- Every existing row currently has is_available = true (column default),
-- including auto-seeded price-0/stock-0 rows that were hidden only because
-- stock = 0. Translate the old routing signal into is_available, but require a
-- real price too: a listing with price = 0 is invalid selling data even if it
-- had stock (the reprice RPC rejects price <= 0), so it must NOT come across as
-- available. Providers are forced to set a real price before a listing is live.
UPDATE public.provider_products
  SET is_available = (stock > 0 AND price > 0);


-- ── 2. select_provider_for_order(): drop stock validation, keep reprice ─────
-- Removed: the `stock >= quantity` check (v_stock variable + insufficient-stock
--          exception).
-- Kept:    listing-existence check (v_price IS NULL), price-set check
--          (v_price <= 0), reprice of order_items, order total + status update.
-- The price lookup still requires is_available = true, which is now the
-- availability gate (the analog of the old stock>0 re-check at selection time).
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
        total_amount = v_total,
        status = 'in_transit'
  where id = p_order_id;
end;
$$;

grant execute on function public.select_provider_for_order(uuid, uuid) to authenticated;


-- ── 3. Auto-assign functions: stop writing stock; seed is_available = false ─
-- New listings are seeded inactive (price 0, is_available false) so a provider
-- must explicitly opt in to selling each product. (Column default for
-- is_available stays true; these seed paths now set false explicitly.)

-- 3a. Bulk assign helper (called by handle_new_user on provider registration).
CREATE OR REPLACE FUNCTION public.assign_all_products_to_provider(provider_uuid uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO public.provider_products (provider_id, product_id, price, is_available)
  SELECT provider_uuid, p.id, 0.00, false
  FROM public.products p
  WHERE p.is_active = true
  ON CONFLICT (provider_id, product_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3b. New-product trigger function (fires AFTER INSERT ON products).
CREATE OR REPLACE FUNCTION public.assign_new_product_to_all_providers()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.provider_products (provider_id, product_id, price, is_available)
  SELECT p.id, NEW.id, 0.00, false
  FROM public.profiles p
  WHERE p.role = 'provider'
    AND p.is_approved = true
  ON CONFLICT (provider_id, product_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3c. On-approval trigger function (fires AFTER UPDATE ON profiles, false->true).
CREATE OR REPLACE FUNCTION public.assign_products_on_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_approved = true AND OLD.is_approved = false AND NEW.role = 'provider' THEN
    INSERT INTO public.provider_products (provider_id, product_id, price, is_available)
    SELECT NEW.id, p.id, 0.00, false
    FROM public.products p
    WHERE p.is_active = true
    ON CONFLICT (provider_id, product_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 4. Drop the stock-deduction RPC ─────────────────────────────────────────
-- Pure stock side-effect; nothing else depends on it. (The edge function will
-- stop calling it in Phase 2 — see deployment-ordering note above.)
DROP FUNCTION IF EXISTS public.deduct_provider_stock(uuid, uuid, integer);

-- No-op for documentation: there is no trg_deduct_stock trigger. The delivery
-- trigger is on_order_delivered (balance/fee only) and is intentionally kept.
DROP TRIGGER IF EXISTS trg_deduct_stock ON public.orders;


-- ── 5. Drop the stock column ────────────────────────────────────────────────
-- Safe: no index, FK, view, or generated column depends on it, and after the
-- function rewrites above no live DB function references it.
ALTER TABLE public.provider_products DROP COLUMN stock;


-- ── 6. Deprecate (don't drop) min_stock_level ───────────────────────────────
-- Kept so the admin Settings UI keeps working; removed in a later cleanup pass.
COMMENT ON COLUMN public.platform_settings.min_stock_level IS
  'DEPRECATED (Phase C #1): stock tracking removed in favor of provider_products.is_available. No longer drives any low-stock logic. Slated for removal in a later cleanup migration.';
