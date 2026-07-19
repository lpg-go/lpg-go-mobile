-- ============================================================================
-- PayMongo provider top-up: settings, topups ledger, credit RPC, hardening.
-- Apply MANUALLY via the Supabase SQL Editor (never `supabase db push`).
-- ============================================================================

-- 1. platform_settings: fee config + per-method top-up toggles + min/max.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS fee_rate_gcash    numeric(6,4)   NOT NULL DEFAULT 0.025,
  ADD COLUMN IF NOT EXISTS fee_rate_maya     numeric(6,4)   NOT NULL DEFAULT 0.020,
  ADD COLUMN IF NOT EXISTS fee_rate_card     numeric(6,4)   NOT NULL DEFAULT 0.035,
  ADD COLUMN IF NOT EXISTS fee_fixed_card    numeric(10,2)  NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS allow_gcash_topup boolean        NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_maya_topup  boolean        NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_card_topup  boolean        NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS topup_min_amount  numeric(10,2)  NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS topup_max_amount  numeric(10,2)  NOT NULL DEFAULT 50000;

-- Sanity constraints on admin-editable money params. DROP-IF-EXISTS first so a
-- partial manual re-apply is safe (ADD CONSTRAINT has no IF NOT EXISTS form).
ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS topup_fee_rates_valid,
  DROP CONSTRAINT IF EXISTS topup_fee_fixed_valid,
  DROP CONSTRAINT IF EXISTS topup_amounts_valid;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT topup_fee_rates_valid CHECK (
    fee_rate_gcash >= 0 AND fee_rate_gcash < 1 AND
    fee_rate_maya  >= 0 AND fee_rate_maya  < 1 AND
    fee_rate_card  >= 0 AND fee_rate_card  < 1
  ),
  ADD CONSTRAINT topup_fee_fixed_valid CHECK (fee_fixed_card >= 0),
  ADD CONSTRAINT topup_amounts_valid   CHECK (
    topup_min_amount > 0 AND topup_max_amount >= topup_min_amount
  );

-- 2. topups: pending ledger + idempotency key.
CREATE TABLE IF NOT EXISTS public.topups (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          uuid          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  method               text          NOT NULL CHECK (method IN ('gcash','paymaya','card')),
  base_amount          numeric(10,2) NOT NULL CHECK (base_amount > 0),
  fee_amount           numeric(10,2) NOT NULL CHECK (fee_amount >= 0),
  charge_amount        numeric(10,2) NOT NULL CHECK (charge_amount > 0),
  checkout_session_id  text          NOT NULL UNIQUE,
  payment_id           text,
  net_amount           numeric(10,2),
  status               text          NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending','paid','failed','expired')),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  paid_at              timestamptz
);
ALTER TABLE public.topups ENABLE ROW LEVEL SECURITY;

-- Provider may read only their own rows (client polls status). No client writes.
DROP POLICY IF EXISTS topups_select_own ON public.topups;
CREATE POLICY topups_select_own ON public.topups
  FOR SELECT TO authenticated
  USING (provider_id = auth.uid());

REVOKE ALL      ON public.topups FROM anon, authenticated;
GRANT  SELECT   ON public.topups TO authenticated;   -- gated by the RLS policy above

-- 3. confirm_topup: the ONLY path that credits balance. Idempotent; validates
--    the (already signature-verified) event's amount + status before crediting.
CREATE OR REPLACE FUNCTION public.confirm_topup(
  p_session_id   text,
  p_payment_id   text,
  p_paid_amount  numeric,
  p_net_amount   numeric,
  p_status       text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topup public.topups%ROWTYPE;
BEGIN
  SELECT * INTO v_topup FROM public.topups
    WHERE checkout_session_id = p_session_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'unknown';
  END IF;
  IF v_topup.status <> 'pending' THEN
    RETURN 'duplicate';
  END IF;

  IF p_status IS DISTINCT FROM 'paid' THEN
    RETURN 'not_paid';
  END IF;

  IF p_paid_amount IS DISTINCT FROM v_topup.charge_amount THEN
    UPDATE public.topups SET status = 'failed' WHERE id = v_topup.id;
    RAISE WARNING 'confirm_topup: paid (%) <> charge (%) for topup % — not credited',
      p_paid_amount, v_topup.charge_amount, v_topup.id;
    RETURN 'amount_mismatch';
  END IF;

  IF p_net_amount IS NOT NULL AND p_net_amount < v_topup.base_amount THEN
    RAISE WARNING 'confirm_topup: net (%) < base (%) for topup % — fee rate under-configured (VAT?)',
      p_net_amount, v_topup.base_amount, v_topup.id;
  END IF;

  UPDATE public.topups
    SET status = 'paid', payment_id = p_payment_id, net_amount = p_net_amount, paid_at = now()
    WHERE id = v_topup.id;

  UPDATE public.profiles
    SET balance = balance + v_topup.base_amount
    WHERE id = v_topup.provider_id;

  INSERT INTO public.transactions (provider_id, type, amount, reference_id)
    VALUES (v_topup.provider_id, 'topup', v_topup.base_amount, p_payment_id);

  RETURN 'processed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_topup(text, text, numeric, numeric, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_topup(text, text, numeric, numeric, text) TO service_role;

-- 4. Defensive hardening: migration 057 revoked these from `authenticated` only;
--    `anon` still holds them. Close the second write-path on the money column.
REVOKE UPDATE, DELETE, TRUNCATE ON public.profiles FROM anon;
