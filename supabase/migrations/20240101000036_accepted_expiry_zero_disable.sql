-- Make order_expiry_accepted_minutes = 0 mean "never expire on acceptance".
-- When the setting is 0, the trigger leaves expires_at untouched (no UPDATE).
-- When > 0, it behaves as before: on the FIRST live acceptance, recompute the
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

    -- 0 means "never expire" — skip the UPDATE entirely, leaving expires_at as-is.
    IF accepted_minutes > 0 THEN
      -- Recompute expiry only if the order is still in a pre-selection state
      UPDATE public.orders
      SET expires_at = now() + (accepted_minutes || ' minutes')::interval
      WHERE id = NEW.order_id
        AND status IN ('pending', 'awaiting_dealer_selection')
        AND selected_provider_id IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger trg_set_accepted_order_expiry (from the previous migration) already
-- points at this function; CREATE OR REPLACE keeps it attached, no re-create needed.
