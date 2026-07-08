-- C1 (security audit) — CRITICAL account-takeover fix.
--
-- password_reset_tokens was created (migration 066) WITHOUT row level security,
-- on the assumption that "only the Edge Functions touch it". That assumption is
-- false: every table in the public schema is exposed through PostgREST and gets
-- default privileges for the anon/authenticated roles — and the anon key ships
-- inside the mobile app. Because the row's `id` IS the reset token, an attacker
-- with the public anon key could:
--   1. POST a token row for any victim's phone and read back its id, then
--   2. call the reset-password Edge Function with that token to set a new
--      password — full takeover of ANY account (including admin), with no OTP.
-- Read access alone also leaks live tokens for legitimate in-flight resets.
--
-- Fix: enable RLS with NO client policies and revoke all direct privileges from
-- anon/authenticated. The reset-password Edge Function uses the service-role key,
-- which bypasses both RLS and these grants, so the legitimate flow is unaffected.
-- (Mirrors how otp_verifications is already locked down.)

alter table public.password_reset_tokens enable row level security;

revoke all on public.password_reset_tokens from anon, authenticated;
