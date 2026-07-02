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

-- No RLS needed: this table is only ever read/written by Edge Functions using
-- the service-role key (which bypasses RLS), never by client sessions.

-- check_otp is no longer used: verify-otp now does the real consume (signup
-- pattern), so the read-only pre-check on the OTP screen is obsolete.
DROP FUNCTION IF EXISTS public.check_otp(text, text);
