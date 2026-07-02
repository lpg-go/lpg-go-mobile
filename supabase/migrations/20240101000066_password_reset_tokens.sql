-- Password reset tokens (forgot-password flow, revised).
--
-- We're back to the signup pattern: verify-otp does the REAL OTP consume (via
-- consume_otp) and, on success, issues a short-lived opaque token here. The
-- reset-password function then gates the actual password change on this token —
-- NOT on the OTP code. This decouples "proved possession of the code" (verify-otp)
-- from "set the new password" (reset-password) without re-sending the code.
--
-- The token is single-use (used flag), short-lived (5 min), and phone-bound.

CREATE TABLE public.password_reset_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text        NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  used       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Only service-role (Edge Functions) may read/write. Mirrors otp_verifications.
CREATE POLICY "password_reset_tokens: service role only"
  ON public.password_reset_tokens
  USING (false)
  WITH CHECK (false);

-- check_otp is no longer used: verify-otp now does the real consume (signup
-- pattern), so the read-only pre-check on the OTP screen is obsolete.
DROP FUNCTION IF EXISTS public.check_otp(text, text);
