-- ============================================================================
-- Provider loyalty / VIP — MONTHLY GRANT (cron + function).
-- ============================================================================
-- On the 1st of each month (08:00 PHT) this awards each provider the tier they
-- earned for LAST month and sets the badge that displays during the new month.
-- Schema lives in migration 050.
--
-- Manila window math: pg_cron runs in UTC, but "last month" must be a
-- Philippine-local month. We truncate in Asia/Manila wall-clock and cast back
-- to timestamptz, then compare against orders.delivered_at (a UTC timestamptz)
-- over the half-open range [prev_month_start, this_month_start). Doing the
-- truncation in UTC instead would misfile boundary-day deliveries.
--
-- Double-run guard: each provider is updated in ONE atomic statement that bumps
-- balance, sets the tier, and stamps last_loyalty_month = the rewarded month's
-- first day, gated on last_loyalty_month being different from that day. The
-- 'loyalty' transaction is inserted ONLY when that UPDATE actually applied AND a
-- credit was granted — so a re-fired cron, a crash mid-loop, or a manual test
-- call can never double-grant. Because the stamp and the balance bump are the
-- same UPDATE, they can't drift apart.
--
-- Manually callable for testing: SELECT run_monthly_loyalty();  — safe to call
-- on demand thanks to the guard. It rewards whatever the *previous* Manila month
-- is relative to now(); to deliberately re-test the same month, clear the guard
-- first (UPDATE profiles SET last_loyalty_month = NULL ...).
--
-- Errors are intentionally NOT swallowed: this runs in its own cron transaction
-- (not the signup transaction), so throwing is safe and surfaces real problems
-- during testing. The per-provider guarded UPDATE means a re-run resumes cleanly.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_monthly_loyalty()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled          boolean;
  this_month_start   timestamptz;
  prev_month_start   timestamptz;
  v_month_first_day  date;
  rec                record;
  v_count            integer;
  v_tier             text;
  v_credit           numeric(10, 2);
BEGIN
  -- 1. Gate on the platform toggle. Disabled => do nothing at all.
  SELECT loyalty_enabled INTO v_enabled
    FROM public.platform_settings
   WHERE id = 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN;
  END IF;

  -- 2. Manila month window (see header). Truncate in PH local, cast back to
  --    timestamptz so the boundaries are correct UTC instants.
  this_month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila';
  prev_month_start := (date_trunc('month', now() AT TIME ZONE 'Asia/Manila') - interval '1 month') AT TIME ZONE 'Asia/Manila';
  -- Derive guard date from the naive Manila truncation, not from the timestamptz
  -- (prev_month_start::date drops to UTC and lands one day early).
  v_month_first_day := (date_trunc('month', now() AT TIME ZONE 'Asia/Manila') - interval '1 month')::date;  -- the month being rewarded = double-run guard value

  -- 3. Per-provider.
  FOR rec IN SELECT id FROM public.profiles WHERE role = 'provider' LOOP

    -- a. Count last month's delivered orders (half-open window).
    SELECT count(*) INTO v_count
      FROM public.orders
     WHERE selected_provider_id = rec.id
       AND status = 'delivered'
       AND delivered_at >= prev_month_start
       AND delivered_at <  this_month_start;

    -- b. Highest tier whose threshold is met. No row => no tier reached.
    v_tier := NULL;
    v_credit := NULL;
    SELECT name, credit INTO v_tier, v_credit
      FROM public.loyalty_tiers
     WHERE threshold <= v_count
     ORDER BY threshold DESC
     LIMIT 1;

    -- c. Atomic guarded update: tier + stamp + balance in ONE statement.
    --    The guard makes this a no-op if the provider was already processed
    --    for this month (re-run / manual test safety).
    UPDATE public.profiles
       SET loyalty_tier        = v_tier,                  -- null if no tier reached
           last_loyalty_month  = v_month_first_day,
           balance             = balance + COALESCE(v_credit, 0)
     WHERE id = rec.id
       AND last_loyalty_month IS DISTINCT FROM v_month_first_day;

    -- d. Record the credit ONLY when the guarded UPDATE applied AND a tier with
    --    a positive credit was earned. If the guard skipped (already granted) or
    --    no tier was reached, insert nothing.
    IF FOUND AND v_tier IS NOT NULL AND COALESCE(v_credit, 0) > 0 THEN
      INSERT INTO public.transactions (provider_id, type, amount)
      VALUES (rec.id, 'loyalty', v_credit);
    END IF;

  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- Schedule: 0 0 1 * * UTC = 08:00 PHT on the 1st of each month.
-- Unschedule any prior job of the same name first so re-running is clean.
-- ----------------------------------------------------------------------------
SELECT cron.unschedule('monthly-loyalty')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-loyalty');

SELECT cron.schedule('monthly-loyalty', '0 0 1 * *', 'SELECT public.run_monthly_loyalty()');
