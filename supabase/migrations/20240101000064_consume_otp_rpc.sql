-- Atomic OTP verify + consume (Security H6).
--
-- The prior consume logic lived in JS (_shared/otp.ts): fetch the latest unused
-- row, check attempts in JS, then a blind UPDATE keyed only on id. That is
-- read-then-write and non-atomic — two parallel verify requests both read
-- attempts=4, both pass the < 5 check, and both proceed, defeating the 5-try
-- lockout. An attacker firing N concurrent requests gets N guesses per code.
--
-- This RPC moves the whole verify+consume into a single transaction and takes a
-- row lock (SELECT ... FOR UPDATE) on the target OTP row. Concurrent callers
-- serialize on that lock: the second waits for the first to commit, then reads
-- the *incremented* attempts value. That is what closes the race.
--
-- Returns a status text the caller maps to its existing error strings:
--   'ok' | 'incorrect' | 'locked' | 'expired' | 'not_found'

CREATE OR REPLACE FUNCTION public.consume_otp(p_phone text, p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id         uuid;
  v_code       text;
  v_expires_at timestamptz;
  v_attempts   integer;
  v_used       boolean;
BEGIN
  -- 1. Latest unused OTP for this phone. No lock yet — just find the target id.
  SELECT id
    INTO v_id
    FROM otp_verifications
   WHERE phone = p_phone
     AND used = false
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN 'not_found';
  END IF;

  -- 2. Lock that specific row. This is the serialization point: a second
  --    concurrent caller blocks here until the first transaction commits, then
  --    re-reads the row below and sees the updated attempts/used values.
  SELECT id, code, expires_at, attempts, used
    INTO v_id, v_code, v_expires_at, v_attempts, v_used
    FROM otp_verifications
   WHERE id = v_id
   FOR UPDATE;

  -- 3. Evaluate under the lock, in order.
  -- Row was consumed between step 1's lookup and step 2's lock — treat as gone.
  IF v_used THEN
    RETURN 'not_found';
  END IF;

  IF v_expires_at <= now() THEN
    RETURN 'expired';
  END IF;

  IF v_attempts >= 5 THEN
    RETURN 'locked';
  END IF;

  IF v_code = p_code THEN
    UPDATE otp_verifications
       SET used = true
     WHERE id = v_id;
    RETURN 'ok';
  END IF;

  -- Wrong code — burn an attempt. Burn (used=true) on the 5th failure to force a
  -- resend. The WHERE is keyed on the locked id, so this write is atomic wrt the
  -- read above.
  UPDATE otp_verifications
     SET attempts = v_attempts + 1,
         used = (v_attempts + 1 >= 5)
   WHERE id = v_id;

  -- The attempt that reaches the limit reports 'locked' (not 'incorrect'), so the
  -- user sees "Too many attempts" on that same attempt rather than on the next.
  IF v_attempts + 1 >= 5 THEN
    RETURN 'locked';
  END IF;

  RETURN 'incorrect';
END;
$$;

-- verify-otp and reset-password call this via the service-role client, but grant
-- to authenticated too for safety / future callers.
GRANT EXECUTE ON FUNCTION public.consume_otp(text, text) TO authenticated;
