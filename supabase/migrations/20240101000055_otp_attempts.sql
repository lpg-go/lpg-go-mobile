-- OTP rate limiting + verify lockout support.
-- attempts: number of failed verify attempts against an OTP row (lockout at >= 5).
-- idx_otp_phone_created: backs per-phone throttle window counts in send-otp.

ALTER TABLE public.otp_verifications
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_otp_phone_created
  ON public.otp_verifications(phone, created_at);
