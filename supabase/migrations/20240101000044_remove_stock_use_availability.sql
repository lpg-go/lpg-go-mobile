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
--   2. (removed — see section 2. Formerly redefined select_provider_for_order();
--      that function is owned by migration 085 and must not be touched here.)
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


-- ── 2. (removed — intentionally left blank) ─────────────────────────────────
-- This section used to redefine select_provider_for_order() to drop its
-- `stock >= quantity` validation. It was deleted before this migration was
-- applied, for two reasons:
--
--   * STALE. Migrations 052/061/083 already removed the stock check from that
--     function, so the section had no remaining purpose.
--   * DANGEROUS. It declared the OLD 2-arg signature (p_order_id, p_provider_id).
--     The live function is the 4-arg form (061 added the express-fee args; 083
--     added the provider-approval gate). A differing argument list makes
--     `create or replace` an OVERLOAD, not a replace — applying it would have
--     ADDED a granted, authenticated-callable 2-arg sibling that prices from the
--     live provider_products row (re-opening the price TOCTOU that 085 closes),
--     skips 083's approval gate, takes no `for update` row lock, and derives no
--     express fee.
--
-- select_provider_for_order() is owned by migration 085
-- (20240101000085_snapshot_provider_quote_on_accept.sql) and is defined
-- correctly there. This migration must not touch it.


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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


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
