-- Enforce invariant from migration 044: a product can only be is_available=true if price > 0. Cleanup flips existing 0-price available rows to unavailable, then constraint prevents recurrence.

-- 1. Cleanup first, so the constraint can apply to existing data.
--    Any row currently marked available with a non-positive price is the bad
--    state that breaks checkout (select_provider_for_order raises
--    "has not set a price for one of the ordered products"). Flip it off.
UPDATE public.provider_products
  SET is_available = false
  WHERE is_available = true AND price <= 0;

-- 2. Add the CHECK constraint: if is_available is true, price must be > 0.
ALTER TABLE public.provider_products
  ADD CONSTRAINT chk_available_requires_price
  CHECK (is_available = false OR price > 0);
