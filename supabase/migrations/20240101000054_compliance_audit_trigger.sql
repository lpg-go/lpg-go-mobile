-- ============================================================================
-- Provider compliance acceptance — server-side audit (RLS-proof, always fires).
-- ============================================================================
-- Acceptance of the Provider Compliance & Indemnity Undertaking is mandatory:
-- the register.tsx checkbox gates signup, so every provider profile implies an
-- acceptance. Rather than trust a client INSERT (which RLS could block, or a
-- flaky network could drop), we record the audit row here from an AFTER INSERT
-- trigger on profiles — it fires for every provider, inside the same signup
-- transaction, with the exact text/version live in platform_settings at signup.
--
-- CRITICAL: this fires AFTER INSERT on public.profiles, which runs inside the
-- auth signup transaction (same as the promo/loyalty/display_id triggers). If
-- it throws, it rolls back the entire signup — the "Database error saving new
-- user" class of bug. So the whole body is wrapped in a catch-all EXCEPTION
-- handler: a failed audit insert must degrade to "no row recorded", never to a
-- failed signup. (The checkbox already enforced acceptance; this is logging.)
-- ============================================================================

-- 1. Audit function — runs in the signup transaction; must not throw.
CREATE OR REPLACE FUNCTION public.record_compliance_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_text    text;
  v_version integer;
BEGIN
  -- Providers only. Customers never accept the undertaking.
  IF NEW.role IS DISTINCT FROM 'provider' THEN
    RETURN NEW;
  END IF;

  -- Read the live undertaking text + version. Guard a missing settings row.
  SELECT compliance_text, compliance_version
    INTO v_text, v_version
    FROM public.platform_settings
   WHERE id = 1;

  -- Nothing configured to record — no text means no undertaking to snapshot.
  IF v_text IS NULL OR length(btrim(v_text)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Snapshot exactly what was in effect at signup.
  INSERT INTO public.provider_compliance_acceptances
    (provider_id, version, undertaking_text)
  VALUES (NEW.id, COALESCE(v_version, 1), v_text);

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    -- Safety net: never let an audit error roll back the auth signup. Catching
    -- here discards this function's own work and lets signup proceed.
    RETURN NEW;
END;
$$;

-- 2. Trigger: AFTER INSERT so the profiles row already exists (FK target) when
--    we write the acceptance.
DROP TRIGGER IF EXISTS trg_record_compliance_acceptance ON public.profiles;
CREATE TRIGGER trg_record_compliance_acceptance
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.record_compliance_acceptance();
