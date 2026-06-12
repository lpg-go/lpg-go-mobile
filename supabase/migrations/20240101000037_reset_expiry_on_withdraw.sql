-- Reset an order's expiry when its LAST live acceptance is withdrawn.
--
-- When an acceptance is withdrawn (withdrawn_at goes NULL -> timestamp), if no
-- other live (non-withdrawn) acceptances remain and the order is still in a
-- pre-selection state, roll the order back onto the no-accept window:
--   order_expiry_minutes from platform_settings (0 = never expire => null).
-- If other live acceptances remain, leave expires_at untouched (someone's still
-- bidding on the accepted window).
CREATE OR REPLACE FUNCTION public.reset_expiry_on_withdraw()
RETURNS trigger AS $$
DECLARE
  live_count integer;
  expiry_minutes integer;
BEGIN
  -- Only act when this update is the withdrawal itself (NULL -> timestamp)
  IF OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL THEN
    -- Count remaining live acceptances for this order (excluding this row)
    SELECT count(*) INTO live_count
    FROM public.order_acceptances
    WHERE order_id = NEW.order_id
      AND id <> NEW.id
      AND withdrawn_at IS NULL;

    -- Only reset when this was the last live acceptance
    IF live_count = 0 THEN
      SELECT order_expiry_minutes INTO expiry_minutes
      FROM public.platform_settings
      WHERE id = 1;

      IF expiry_minutes IS NULL THEN
        expiry_minutes := 10;
      END IF;

      UPDATE public.orders
      SET expires_at = CASE
        WHEN expiry_minutes > 0
          THEN now() + (expiry_minutes || ' minutes')::interval
        ELSE NULL  -- 0 means never expire
      END
      WHERE id = NEW.order_id
        AND status IN ('pending', 'awaiting_dealer_selection')
        AND selected_provider_id IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach the trigger
DROP TRIGGER IF EXISTS trg_reset_expiry_on_withdraw ON public.order_acceptances;
CREATE TRIGGER trg_reset_expiry_on_withdraw
AFTER UPDATE ON public.order_acceptances
FOR EACH ROW
EXECUTE FUNCTION public.reset_expiry_on_withdraw();
