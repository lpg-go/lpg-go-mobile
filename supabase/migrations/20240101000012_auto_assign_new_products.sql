-- ============================================================
-- Migration: auto-assign newly inserted products to all approved providers
-- ============================================================

-- ── 1. Trigger function ──────────────────────────────────────
-- Fires after each new product row; inserts a provider_products
-- row for every approved provider (price=0, stock=0 as defaults).

CREATE OR REPLACE FUNCTION assign_new_product_to_all_providers()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.provider_products (provider_id, product_id, price, stock)
  SELECT p.id, NEW.id, 0.00, 0
  FROM public.profiles p
  WHERE p.role = 'provider'
  AND p.is_approved = true
  ON CONFLICT (provider_id, product_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. Attach trigger to products table ─────────────────────

DROP TRIGGER IF EXISTS trg_assign_new_product ON public.products;

CREATE TRIGGER trg_assign_new_product
AFTER INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION assign_new_product_to_all_providers();

-- ── 3. Backfill: assign any products not yet in provider_products
-- Reuses the helper from migration 20240101000011.

SELECT public.assign_all_products_to_provider(id)
FROM public.profiles
WHERE role = 'provider' AND is_approved = true;
