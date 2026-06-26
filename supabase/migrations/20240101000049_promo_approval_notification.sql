-- ============================================================================
-- Promo approval notification — tell a provider they got signup credit.
-- ============================================================================
-- When a provider is approved (is_approved false -> true) AND they actually
-- received a signup promo credit, drop them an in-app notification. Tapping it
-- opens the provider earnings screen (handled client-side via type).
--
-- "Got a promo" is determined by the existence of the 'promo' transactions row
-- written by the grant trigger (migration 048). Providers who signed up after
-- the promo slots ran out have no such row and get no notification.
--
-- In-app only (a notifications row); no push. notifications.type is plain text
-- (migration 028), so 'signup_promo' needs no enum/constraint change.
--
-- CRITICAL: the auto-approve path (migration 038) flips is_approved inside the
-- signup transaction, so this trigger can fire there. It MUST NOT throw, or it
-- rolls back signup — wrap the body in a catch-all that degrades to "no
-- notification" (same discipline as the promo grant trigger).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_promo_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric(10, 2);
BEGIN
  -- Same gate as the existing approval trigger (migration 016).
  IF NEW.is_approved = true AND OLD.is_approved = false AND NEW.role = 'provider' THEN

    -- Did this provider receive a signup promo credit?
    SELECT amount
      INTO v_amount
      FROM public.transactions
     WHERE provider_id = NEW.id
       AND type = 'promo'
     LIMIT 1;

    -- No promo row => nothing to announce.
    IF v_amount IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.notifications (user_id, title, body, type)
    VALUES (
      NEW.id,
      'Free Signup Credit!',
      'You''ve received ₱' || trim_scale(v_amount)::text || ' free signup credit. Tap to view your balance.',
      'signup_promo'
    );

  END IF;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    -- Never let a notification failure roll back approval / signup.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_promo_on_approval ON public.profiles;
CREATE TRIGGER trg_notify_promo_on_approval
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_promo_on_approval();
