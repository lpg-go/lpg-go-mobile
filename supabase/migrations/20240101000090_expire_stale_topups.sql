-- ============================================================================
-- Expire abandoned top-up sessions (pg_cron sweep).
-- ============================================================================
-- A `topups` row is created `pending` at checkout creation and only ever flips
-- to `paid`/`failed` via the signature-verified PayMongo webhook (`confirm_topup`).
-- Abandoned sessions (provider closed the browser) stay `pending` forever, so the
-- table accumulates dead rows. This hourly sweep marks them `expired`.
--
-- CRITICAL — the 48h floor is a correctness guard, not just cosmetics.
-- `confirm_topup` credits ONLY a row whose status is `pending`; a row already
-- flipped to `expired` returns 'duplicate' and is NOT credited. So we must never
-- expire a row that could still receive a paid webhook. PayMongo checkout
-- sessions expire well within 24h, so a row still `pending` after **48h** can no
-- longer be paid — expiring it cannot strand a real credit. Do NOT shorten this
-- window without also making `confirm_topup` credit `expired` rows.
--
-- Requires the `pg_cron` extension (already in use — see migration 051).
-- Apply MANUALLY via the Supabase SQL Editor (never `supabase db push`).
-- Test on demand: SELECT public.expire_stale_topups();  -- safe & idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.expire_stale_topups()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.topups
     SET status = 'expired'
   WHERE status = 'pending'
     AND created_at < now() - interval '48 hours';
$$;

-- Clients never call this; the cron (as the job owner) does. Revoke broadly.
REVOKE EXECUTE ON FUNCTION public.expire_stale_topups() FROM public, anon, authenticated;

-- Re-register idempotently (mirror of migration 051's schedule pattern).
SELECT cron.unschedule('expire-stale-topups')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-topups');

SELECT cron.schedule('expire-stale-topups', '0 * * * *', 'SELECT public.expire_stale_topups()');
