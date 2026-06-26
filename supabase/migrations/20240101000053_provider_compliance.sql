-- Provider Compliance & Indemnity Undertaking
-- 1) admin-editable undertaking text + version on platform_settings
-- 2) immutable, insert-only acceptance audit trail (modeled on order_acceptances)

-- 1. platform_settings columns -------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS compliance_text    text,
  ADD COLUMN IF NOT EXISTS compliance_version integer NOT NULL DEFAULT 1;

-- 2. seed current undertaking text (dollar-quoted so punctuation/newlines are safe)
UPDATE public.platform_settings
SET compliance_text = $TEXT$PROVIDER COMPLIANCE AND INDEMNITY UNDERTAKING
The LPG Provider represents, warrants, and undertakes that it is duly licensed, authorized, and qualified to engage in the sale, distribution, and delivery of LPG and shall at all times comply with Republic Act No. 11592 (LPG Industry Regulation Act), its implementing rules and regulations, and all other applicable Philippine laws, regulations, permits, safety standards, and governmental requirements.
The LPG Provider further undertakes that all LPG cylinders delivered through the LPG-Go platform shall contain the exact net weight of LPG represented to the customer, shall be safe, serviceable, properly marked, tested, and compliant with all applicable legal and regulatory standards. The Provider likewise warrants that all cylinders, storage facilities, refilling facilities, transport vehicles, equipment, tools, and personnel utilized in its operations are duly authorized, maintained, certified where required, and compliant with all applicable safety, environmental, and operational requirements imposed by law and regulatory authorities.
The LPG Provider acknowledges that LPG-Go acts solely as a technology platform facilitating transactions between customers and LPG providers. Accordingly, the LPG Provider assumes full responsibility and liability for its products, services, operations, employees, agents, and regulatory compliance, and agrees to defend, indemnify, and hold harmless LPG-Go, its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, losses, liabilities, penalties, fines, costs, and expenses arising from or relating to the Provider's acts, omissions, negligence, breach of law, regulatory violations, or non-compliance with applicable legal and safety requirements.$TEXT$
WHERE id = 1;

-- 3. acceptance audit table (immutable, insert-only) ---------------------------
CREATE TABLE IF NOT EXISTS public.provider_compliance_acceptances (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL,
  undertaking_text text        NOT NULL  -- snapshot of exactly what was accepted
);

CREATE INDEX IF NOT EXISTS idx_compliance_provider
  ON public.provider_compliance_acceptances(provider_id);

-- 4. RLS — mirror order_acceptances --------------------------------------------
ALTER TABLE public.provider_compliance_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compliance: provider insert own"
  ON public.provider_compliance_acceptances;
CREATE POLICY "compliance: provider insert own"
  ON public.provider_compliance_acceptances FOR INSERT
  WITH CHECK (provider_id = auth.uid());

DROP POLICY IF EXISTS "compliance: provider read own"
  ON public.provider_compliance_acceptances;
CREATE POLICY "compliance: provider read own"
  ON public.provider_compliance_acceptances FOR SELECT
  USING (provider_id = auth.uid());

DROP POLICY IF EXISTS "compliance: admin all"
  ON public.provider_compliance_acceptances;
CREATE POLICY "compliance: admin all"
  ON public.provider_compliance_acceptances FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
