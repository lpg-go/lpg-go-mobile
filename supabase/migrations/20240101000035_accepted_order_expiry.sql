-- 1. New setting: expiry window (minutes) for orders that have an acceptance
ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS order_expiry_accepted_minutes integer NOT NULL DEFAULT 5;

-- 2. Trigger function: on first live acceptance of an order, recompute the
-- order's expires_at to now() + order_expiry_accepted_minutes.
CREATE OR REPLACE FUNCTION public.set_accepted_order_expiry()
RETURNS trigger AS $$
DECLARE
  accepted_minutes integer;
  prior_count integer;
BEGIN
  -- Count other non-withdrawn acceptances for this order (excluding this new row)
  SELECT count(*) INTO prior_count
  FROM public.order_acceptances
  WHERE order_id = NEW.order_id
    AND id <> NEW.id
    AND withdrawn_at IS NULL;

  -- Only act on the FIRST live acceptance
  IF prior_count = 0 THEN
    SELECT order_expiry_accepted_minutes INTO accepted_minutes
    FROM public.platform_settings
    WHERE id = 1;

    IF accepted_minutes IS NULL THEN
      accepted_minutes := 5;
    END IF;

    -- Recompute expiry only if the order is still in a pre-selection state
    UPDATE public.orders
    SET expires_at = now() + (accepted_minutes || ' minutes')::interval
    WHERE id = NEW.order_id
      AND status IN ('pending', 'awaiting_dealer_selection')
      AND selected_provider_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach the trigger
DROP TRIGGER IF EXISTS trg_set_accepted_order_expiry ON public.order_acceptances;
CREATE TRIGGER trg_set_accepted_order_expiry
AFTER INSERT ON public.order_acceptances
FOR EACH ROW
EXECUTE FUNCTION public.set_accepted_order_expiry();
