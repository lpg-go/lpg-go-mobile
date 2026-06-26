-- ============================================================================
-- Provider loyalty / VIP — SCHEMA FOUNDATION (structures only).
-- ============================================================================
-- This migration lays down the data structures for the monthly provider
-- loyalty system. It does NOT contain the cron job or the grant logic — those
-- come in a later migration. Here we only:
--   1. add a 'loyalty' transaction type,
--   2. add orders.delivered_at (+ stamp it on delivery, + backfill),
--   3. add profiles loyalty fields (current badge + double-run guard),
--   4. create the loyalty_tiers config table (4 seeded rows, RLS),
--   5. add a platform_settings.loyalty_enabled toggle.
--
-- Enum-add note: 'loyalty' is only ADDED here and used at runtime by the later
-- grant migration; it is never USED (no INSERT/CHECK) at migration time, so it
-- is safe in a single file (same precedent as migration 048's 'promo' add).
--
-- delivered_at note: handle_order_delivered is an AFTER UPDATE trigger, so
-- assigning NEW.delivered_at would not persist. We instead do an explicit,
-- once-only UPDATE (guarded by delivered_at IS NULL). The trigger's WHEN clause
-- (only fires on the false->'delivered' transition) means that inner UPDATE —
-- which changes delivered_at, not status — does NOT re-fire this trigger, so
-- there is no recursion and no risk of a double fee deduction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend transaction_type with 'loyalty' (distinct from 'promo'/'topup' for
--    clean audit + labels). Add-only; used at runtime by the later grant.
-- ----------------------------------------------------------------------------
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'loyalty';

-- ----------------------------------------------------------------------------
-- 2. orders.delivered_at — the reliable per-delivery timestamp the monthly
--    loyalty count needs (orders.updated_at is bumped on every update, so it is
--    NOT a usable delivery time).
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Updated handle_order_delivered: same logic as migration 024 (fee deduction +
-- transaction insert) with a single addition — stamp delivered_at once.
-- (Sourced from migration 024's current definition.)
CREATE OR REPLACE FUNCTION public.handle_order_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN

    -- NEW addition: stamp the delivery time exactly once. This is an AFTER
    -- UPDATE trigger so NEW.* assignments don't persist — do an explicit UPDATE.
    -- Guarded by delivered_at IS NULL (sets once). This UPDATE changes
    -- delivered_at (not status), so the trigger's WHEN clause keeps it from
    -- re-firing — no recursion, no double fee.
    UPDATE public.orders
      SET delivered_at = now()
      WHERE id = NEW.id AND delivered_at IS NULL;

    -- Existing logic (unchanged): deduct the admin fee + record the transaction.
    IF NEW.admin_fee > 0 AND NEW.selected_provider_id IS NOT NULL THEN
      UPDATE public.profiles
        SET balance = balance - NEW.admin_fee
        WHERE id = NEW.selected_provider_id;

      INSERT INTO public.transactions (provider_id, order_id, type, amount)
        VALUES (NEW.selected_provider_id, NEW.id, 'fee_deduction', NEW.admin_fee);
    END IF;

  END IF;
  RETURN NEW;
END;
$$;

-- Backfill historical rows. updated_at is only an APPROXIMATION of delivery time
-- for already-delivered orders (it reflects the last update, which is usually
-- the delivery for these rows). Side effect: this UPDATE fires the BEFORE-update
-- set_updated_at trigger, so updated_at is re-stamped to now() on these rows —
-- acceptable, since delivered_at captures the prior value via the SET expression.
UPDATE public.orders
  SET delivered_at = updated_at
  WHERE status = 'delivered' AND delivered_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3. profiles loyalty fields.
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS loyalty_tier       text,   -- current badge: null = no badge
  ADD COLUMN IF NOT EXISTS last_loyalty_month date;   -- double-run guard: first-of-month date last granted

-- ----------------------------------------------------------------------------
-- 4. loyalty_tiers — admin-configured tier thresholds + credits (4 rows).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_tiers (
  name       text PRIMARY KEY,          -- 'bronze','silver','gold','platinum'
  threshold  integer        NOT NULL,   -- min delivered orders in a month to reach this tier
  credit     numeric(10, 2) NOT NULL,   -- credit granted for hitting this tier
  sort_order integer        NOT NULL
);

-- Seed default tiers (placeholder values; admin edits later).
INSERT INTO public.loyalty_tiers (name, threshold, credit, sort_order) VALUES
  ('bronze',    10,  100.00, 1),
  ('silver',    25,  300.00, 2),
  ('gold',      50,  700.00, 3),
  ('platinum', 100, 1500.00, 4)
ON CONFLICT (name) DO NOTHING;

-- RLS — mirror the platform_settings pattern: public read, admin write.
ALTER TABLE public.loyalty_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loyalty_tiers: public read"
  ON public.loyalty_tiers FOR SELECT
  USING (true);

CREATE POLICY "loyalty_tiers: admin write"
  ON public.loyalty_tiers FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. platform_settings toggle.
-- ----------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS loyalty_enabled boolean NOT NULL DEFAULT false;
