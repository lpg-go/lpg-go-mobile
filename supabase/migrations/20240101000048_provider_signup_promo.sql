-- ============================================================================
-- Provider signup promo — first N providers get a fixed ₱ credit, once.
-- ============================================================================
-- The first `signup_promo_count` providers to sign up each receive a one-time
-- `signup_promo_amount` credit added to profiles.balance, plus a 'promo' ledger
-- row in transactions. N and amount are admin-configured in platform_settings.
--
-- Concurrency: an atomic counter (signup_promo_granted) is incremented via a
-- conditional UPDATE that only succeeds while granted < count. The single-row
-- UPDATE takes a row lock, so concurrent signups serialize on it and the promo
-- can never overshoot N (no count(*) race).
--
-- Mechanics mirror the inverted fee-deduction logic from migration 024
-- (handle_order_delivered): bump balance + write a transactions row, in one
-- SECURITY DEFINER function with a pinned search_path.
--
-- CRITICAL: this trigger fires AFTER INSERT on public.profiles, which runs
-- inside the auth signup transaction (same as the display_id trigger). If it
-- throws, it rolls back the entire signup — the exact "Database error saving
-- new user" class of bug. Therefore every step is guarded AND the whole body is
-- wrapped in a catch-all EXCEPTION handler: a failed promo must degrade to
-- "no credit granted", never to a failed signup.
--
-- Enum-add note: 'promo' is only ADDED and REFERENCED inside a function body
-- here; it is never USED (no INSERT/CHECK) at migration time. The literal is
-- coerced to transaction_type at runtime in later signup transactions, so this
-- migration is safe as a single file (no 048a/048b split needed on PG12+).
-- ============================================================================

-- 1. Extend the transaction_type enum with a distinct 'promo' value so the
--    credit is labelled separately from real top-ups in earnings/admin views.
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'promo';

-- 2. Promo config + atomic grant counter on the single-row platform_settings.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS signup_promo_enabled boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signup_promo_count   integer        NOT NULL DEFAULT 0,   -- N eligible providers
  ADD COLUMN IF NOT EXISTS signup_promo_amount  numeric(10, 2) NOT NULL DEFAULT 0,   -- credit per provider
  ADD COLUMN IF NOT EXISTS signup_promo_granted integer        NOT NULL DEFAULT 0;   -- atomic claim counter

-- 3. Grant function — runs in the signup transaction; must not throw.
CREATE OR REPLACE FUNCTION public.grant_signup_promo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_amount  numeric(10, 2);
BEGIN
  -- Providers only. (role is reliably set at insert for normal provider signups;
  -- provider_type may be null here, which is fine — we key on role.)
  IF NEW.role IS DISTINCT FROM 'provider' THEN
    RETURN NEW;
  END IF;

  -- Read promo config. Guard against a missing settings row.
  SELECT signup_promo_enabled, signup_promo_amount
    INTO v_enabled, v_amount
    FROM public.platform_settings
   WHERE id = 1;

  IF NOT COALESCE(v_enabled, false) OR COALESCE(v_amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Atomically claim a slot: this only updates a row while a slot remains.
  -- The row lock serializes concurrent signups, so granted never exceeds count.
  UPDATE public.platform_settings
     SET signup_promo_granted = signup_promo_granted + 1
   WHERE id = 1
     AND signup_promo_granted < signup_promo_count;

  -- No row updated => slots exhausted (or count = 0). Grant nothing.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Slot claimed: credit balance + write the ledger row (mirror of migration 024).
  UPDATE public.profiles
     SET balance = balance + v_amount
   WHERE id = NEW.id;

  INSERT INTO public.transactions (provider_id, type, amount)
  VALUES (NEW.id, 'promo', v_amount);

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    -- Safety net: never let a promo error roll back the auth signup. Catching
    -- here rolls back this function's own work (incl. the slot claim) to the
    -- pre-trigger state, so the counter stays consistent and signup proceeds.
    RETURN NEW;
END;
$$;

-- Trigger: AFTER INSERT so the profiles row already exists when we credit it.
DROP TRIGGER IF EXISTS trg_grant_signup_promo ON public.profiles;
CREATE TRIGGER trg_grant_signup_promo
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_signup_promo();
