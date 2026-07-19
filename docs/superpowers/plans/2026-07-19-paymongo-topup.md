# PayMongo Provider Top-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the provider "Top Up Balance" screen to real PayMongo payments (GCash, Maya, card), crediting `profiles.balance` only after a signature-verified webhook confirms.

**Architecture:** Provider picks amount + method in-app → an edge function computes the gross charge server-side and creates a PayMongo hosted Checkout Session locked to that method → the provider pays on PayMongo → a signature-verified webhook calls a `SECURITY DEFINER` RPC that credits `base` exactly (idempotently) → the app polls the `topups` row for the result. A tiny https bounce function returns control to the app scheme.

**Tech Stack:** React Native + Expo SDK 54, Expo Router ~6, TypeScript (strict); Supabase Postgres + Deno edge functions; PayMongo `/v1` Checkout Sessions.

**Design spec:** `docs/superpowers/specs/2026-07-18-paymongo-topup-design.md` — read it before starting. This plan implements that spec; where this plan and the spec disagree, the spec wins.

## Global Constraints

- **No test runner exists** (`stack.md`). "Verify" here means: `npx tsc --noEmit` at **0 errors**, a **rollback-wrapped SQL harness** for DB logic, `curl` + DB inspection for edge functions, and an **app walk-through** for UI. Do **not** add jest/vitest/MSW.
- **Migrations apply MANUALLY** via the Supabase SQL Editor — **never `supabase db push`** (`NEXT.md`: the ledger is stale). Committing the `.sql` file and applying it in the dashboard are two distinct steps.
- **Money invariants:** gross-credit, `credit = base` exactly; all charge math in **integer centavos**; amounts stored in pesos `numeric(10,2)`; centavos only at the PayMongo boundary. Credit happens **only** via `confirm_topup`, called **only** by the signature-verified webhook.
- **PayMongo:** `/v1/checkout_sessions`; HTTP Basic auth `Basic base64(secretKey + ':')`; method ids `gcash` / `paymaya` / `card`; `metadata` values must be **strings**; signing-secret prefix `whsk_`; webhook envelope v1 (`data.attributes.data...`).
- **Rates are ESTIMATES** until the 4 test probes confirm them: `fee_rate_gcash 0.025`, `fee_rate_maya 0.020`, `fee_rate_card 0.035`, `fee_fixed_card 15`. These are the migration defaults; the probes only change the values, not the schema.
- **Edge functions deploy with `verify_jwt = false`** (webhook gets no JWT; `create-topup-checkout` does its own `getUser`), matching `send-otp`.
- **Secrets** (`PAYMONGO_SECRET_KEY` `sk_test_…`, `PAYMONGO_WEBHOOK_SECRET` `whsk_…`) live in Supabase function secrets — **never committed**. Project ref: `rgqwaiassatyruptsgbs`; scheme: `lpg-go`.
- **Conventions:** `StyleSheet.create` + `lib/theme.ts` tokens (no NativeWind); route files `export default`; client calls edge functions via **raw `fetch`** to `https://<ref>.supabase.co/functions/v1/<fn>` (not `supabase.functions.invoke`).

---

## File Structure

- **Create** `supabase/migrations/20240101000088_paymongo_topup.sql` — settings columns + CHECK constraints, `topups` table + RLS + grants, `confirm_topup` RPC, defensive `anon` REVOKE.
- **Create** `supabase/functions/create-topup-checkout/index.ts` — auth + validation + charge math + PayMongo session creation + pending-row insert.
- **Create** `supabase/functions/paymongo-webhook/index.ts` — raw-body signature verify + `confirm_topup` call + result handling.
- **Create** `supabase/functions/topup-return/index.ts` — 302 bounce to the `lpg-go://` scheme.
- **Modify** `app/(provider)/topup.tsx` — method picker (+ Maya), presets/min, charge summary, real checkout launch + poll.
- **Modify** `lib/database.types.ts` — regenerated after the migration (adds `topups` + new settings columns).
- **Modify** `package.json` / lockfile — adds `expo-web-browser`.

---

## Task 1: Migration 088 — schema, credit RPC, hardening

**Files:**
- Create: `supabase/migrations/20240101000088_paymongo_topup.sql`
- Modify: `lib/database.types.ts` (regenerate after apply)

**Interfaces:**
- Produces: table `public.topups`; new `public.platform_settings` columns (`fee_rate_gcash`, `fee_rate_maya`, `fee_rate_card`, `fee_fixed_card`, `allow_gcash_topup`, `allow_maya_topup`, `allow_card_topup`, `topup_min_amount`, `topup_max_amount`); function `public.confirm_topup(p_session_id text, p_payment_id text, p_paid_amount numeric, p_net_amount numeric, p_status text) RETURNS text` returning one of `processed | duplicate | unknown | not_paid | amount_mismatch`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20240101000088_paymongo_topup.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration to dev**

Open the Supabase SQL Editor for project `rgqwaiassatyruptsgbs` and run the file's contents. Expected: `Success. No rows returned`.

- [ ] **Step 3: Verify the objects exist**

Run in the SQL Editor:

```sql
select to_regclass('public.topups') as topups;                       -- expect: public.topups
select proname from pg_proc where proname = 'confirm_topup';         -- expect: 1 row
select count(*) from information_schema.columns
  where table_name='platform_settings' and column_name like 'fee_rate_%';  -- expect: 3
```

- [ ] **Step 4: Run the confirm_topup behavior harness (rollback-wrapped — this is the "test")**

Run this whole block in the SQL Editor. It seeds a fake provider + pending top-up, exercises every `confirm_topup` branch, asserts with `RAISE EXCEPTION` on any wrong result, then **rolls back** so nothing persists. Expected: it errors with `HARNESS OK` at the end (the intentional final rollback signal), and **no** `ASSERT` failure before it.

```sql
DO $$
DECLARE
  v_provider uuid;
  v_before   numeric;
  v_after    numeric;
  v_res      text;
BEGIN
  -- Seed a provider with a known balance and a pending ₱500 top-up (charge ₱512.83).
  INSERT INTO public.profiles (id, role, is_approved, balance, phone, full_name)
    VALUES (gen_random_uuid(), 'provider', true, 1000, '+639999999999', 'Harness')
    RETURNING id INTO v_provider;
  INSERT INTO public.topups (provider_id, method, base_amount, fee_amount, charge_amount, checkout_session_id, status)
    VALUES (v_provider, 'gcash', 500, 12.83, 512.83, 'cs_harness', 'pending');

  SELECT balance INTO v_before FROM public.profiles WHERE id = v_provider;

  -- (a) amount mismatch → no credit, row failed.
  v_res := public.confirm_topup('cs_harness', 'pay_x', 999.99, 500, 'paid');
  IF v_res <> 'amount_mismatch' THEN RAISE EXCEPTION 'expected amount_mismatch, got %', v_res; END IF;
  SELECT balance INTO v_after FROM public.profiles WHERE id = v_provider;
  IF v_after <> v_before THEN RAISE EXCEPTION 'balance changed on mismatch'; END IF;

  -- reset row to pending for the next case
  UPDATE public.topups SET status='pending' WHERE checkout_session_id='cs_harness';

  -- (b) not paid → no credit.
  v_res := public.confirm_topup('cs_harness', 'pay_x', 512.83, 500, 'awaiting_next_action');
  IF v_res <> 'not_paid' THEN RAISE EXCEPTION 'expected not_paid, got %', v_res; END IF;

  -- (c) happy path → credit exactly base (500), returns processed.
  v_res := public.confirm_topup('cs_harness', 'pay_ok', 512.83, 500, 'paid');
  IF v_res <> 'processed' THEN RAISE EXCEPTION 'expected processed, got %', v_res; END IF;
  SELECT balance INTO v_after FROM public.profiles WHERE id = v_provider;
  IF v_after <> v_before + 500 THEN RAISE EXCEPTION 'expected +500, got %', v_after - v_before; END IF;

  -- (d) duplicate webhook → no double credit.
  v_res := public.confirm_topup('cs_harness', 'pay_ok', 512.83, 500, 'paid');
  IF v_res <> 'duplicate' THEN RAISE EXCEPTION 'expected duplicate, got %', v_res; END IF;
  SELECT balance INTO v_after FROM public.profiles WHERE id = v_provider;
  IF v_after <> v_before + 500 THEN RAISE EXCEPTION 'double credit!'; END IF;

  -- (e) unknown session → unknown.
  v_res := public.confirm_topup('cs_nope', 'pay_x', 1, 1, 'paid');
  IF v_res <> 'unknown' THEN RAISE EXCEPTION 'expected unknown, got %', v_res; END IF;

  RAISE EXCEPTION 'HARNESS OK';   -- forces rollback; all asserts passed
END $$;
```

Expected output: `ERROR: HARNESS OK`. Any other `ERROR:` (e.g. `expected processed, got ...`) is a real failure — fix the function and re-apply before continuing.

- [ ] **Step 5: Regenerate the DB types**

Run: `npx supabase gen types typescript --project-id rgqwaiassatyruptsgbs > lib/database.types.ts`
(If the CLI isn't linked, use the dashboard's type generator.) Then run: `npx tsc --noEmit`
Expected: 0 errors, and `git diff lib/database.types.ts` shows the new `topups` table + settings columns.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20240101000088_paymongo_topup.sql lib/database.types.ts
git commit -m "feat(topup): add 088 migration — topups ledger, confirm_topup RPC, settings, anon revoke"
```

---

## Task 2: `create-topup-checkout` edge function

**Files:**
- Create: `supabase/functions/create-topup-checkout/index.ts`

**Interfaces:**
- Consumes: `public.topups`, `public.platform_settings`, `public.profiles` (from Task 1); env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMONGO_SECRET_KEY`.
- Produces: `POST` endpoint accepting `{ base_amount: number, method: 'gcash'|'paymaya'|'card' }` with `Authorization: Bearer <jwt>`; returns `{ checkout_url: string, topup_id: string }` (200) or `{ error: string }` (4xx/5xx). Inserts one `pending` `topups` row per success. `topup_id` lets the client poll that exact row.

- [ ] **Step 1: Write the function**

Create `supabase/functions/create-topup-checkout/index.ts`:

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const RETURN_BASE = `${SUPABASE_URL}/functions/v1/topup-return`;
const METHODS = ['gcash', 'paymaya', 'card'] as const;
type Method = (typeof METHODS)[number];

function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: CORS });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' },
    });
  }
  if (req.method !== 'POST') return bad('Method not allowed', 405);

  // --- auth: approved provider only ---
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return bad('Missing token', 401);
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return bad('Invalid token', 401);

  const { data: profile } = await supabase
    .from('profiles').select('role, is_approved').eq('id', user.id).single();
  if (!profile || profile.role !== 'provider' || !profile.is_approved) {
    return bad('Not an approved provider', 403);
  }

  // --- input ---
  let body: { base_amount?: unknown; method?: unknown };
  try { body = await req.json(); } catch { return bad('Invalid JSON'); }
  const method = body.method as Method;
  if (!METHODS.includes(method)) return bad('Invalid method');

  const base = Number(body.base_amount);
  if (!Number.isFinite(base) || base <= 0) return bad('Invalid amount');
  const baseCentavos = Math.round(base * 100);
  if (baseCentavos / 100 !== base) return bad('Amount has sub-centavo precision');

  // --- settings + per-method gating ---
  const { data: s } = await supabase
    .from('platform_settings')
    .select('fee_rate_gcash, fee_rate_maya, fee_rate_card, fee_fixed_card, allow_gcash_topup, allow_maya_topup, allow_card_topup, topup_min_amount, topup_max_amount')
    .eq('id', 1).single();
  if (!s) return bad('Settings unavailable', 500);

  const allow = { gcash: s.allow_gcash_topup, paymaya: s.allow_maya_topup, card: s.allow_card_topup }[method];
  if (!allow) return bad('This top-up method is currently unavailable', 403);

  const minCentavos = Math.round(Number(s.topup_min_amount) * 100);
  const maxCentavos = Math.round(Number(s.topup_max_amount) * 100);
  if (baseCentavos < minCentavos) return bad(`Minimum top-up is ₱${s.topup_min_amount}`);
  if (baseCentavos > maxCentavos) return bad(`Maximum top-up is ₱${s.topup_max_amount}`);

  const rate = { gcash: Number(s.fee_rate_gcash), paymaya: Number(s.fee_rate_maya), card: Number(s.fee_rate_card) }[method];
  const fixedCentavos = method === 'card' ? Math.round(Number(s.fee_fixed_card) * 100) : 0;
  if (!(rate >= 0 && rate < 1) || fixedCentavos < 0) return bad('Fee settings misconfigured', 500);

  // --- charge math, integer centavos ---
  const chargeCentavos = Math.ceil((baseCentavos + fixedCentavos) / (1 - rate));
  const feeCentavos = chargeCentavos - baseCentavos;

  // --- create PayMongo checkout session (v1) ---
  const topupId = crypto.randomUUID();
  const auth = 'Basic ' + btoa(PAYMONGO_SECRET_KEY + ':');
  const pmRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { attributes: {
        line_items: [{ name: 'LPG Go balance top-up', amount: chargeCentavos, currency: 'PHP', quantity: 1 }],
        payment_method_types: [method],
        success_url: `${RETURN_BASE}?status=success`,
        cancel_url: `${RETURN_BASE}?status=cancelled`,
        description: `Top-up ₱${base}`,
        reference_number: topupId,
        send_email_receipt: false,
        metadata: { topup_id: topupId, provider_id: user.id },
      } },
    }),
  });
  const pmJson = await pmRes.json();
  if (!pmRes.ok) {
    console.error('[create-topup-checkout] paymongo error:', pmRes.status, JSON.stringify(pmJson));
    return bad('Payment provider error', 502);
  }
  const sessionId: string | undefined = pmJson?.data?.id;
  const checkoutUrl: string | undefined = pmJson?.data?.attributes?.checkout_url;
  if (!sessionId || !checkoutUrl) return bad('Payment provider returned no session', 502);

  // --- persist the pending row (explicit id; keyed on checkout_session_id) ---
  const { error: insErr } = await supabase.from('topups').insert({
    id: topupId,
    provider_id: user.id,
    method,
    base_amount: baseCentavos / 100,
    fee_amount: feeCentavos / 100,
    charge_amount: chargeCentavos / 100,
    checkout_session_id: sessionId,
  });
  if (insErr) {
    console.error('[create-topup-checkout] insert error:', insErr.message);
    return bad('Could not record top-up', 500);
  }

  return new Response(JSON.stringify({ checkout_url: checkoutUrl, topup_id: topupId }), { status: 200, headers: CORS });
});
```

- [ ] **Step 2: Deploy to dev with JWT verification off**

Run: `npx supabase functions deploy create-topup-checkout --no-verify-jwt --project-ref rgqwaiassatyruptsgbs`
Then set the secret (once): `npx supabase secrets set PAYMONGO_SECRET_KEY=sk_test_YOURKEY --project-ref rgqwaiassatyruptsgbs`
Expected: deploy succeeds; the function appears in the dashboard with "Verify JWT" OFF.

- [ ] **Step 3: Verify rejections (no valid session needed)**

Get a provider access token (log in as dealer `09000000002` in the app and copy the session token, or use the Supabase auth REST endpoint). Then:

```bash
REF=rgqwaiassatyruptsgbs
TOKEN=<provider_access_token>
URL=https://$REF.supabase.co/functions/v1/create-topup-checkout
# bad method → 400
curl -s -X POST $URL -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"base_amount":500,"method":"crypto"}'
# sub-centavo → 400
curl -s -X POST $URL -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"base_amount":300.005,"method":"gcash"}'
# below min → 400
curl -s -X POST $URL -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"base_amount":100,"method":"gcash"}'
# no token → 401
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"base_amount":500,"method":"gcash"}'
```
Expected: `{"error":"Invalid method"}`, `{"error":"Amount has sub-centavo precision"}`, `{"error":"Minimum top-up is ₱300.00"}`, `{"error":"Missing token"}`.

- [ ] **Step 4: Verify the happy path creates a session + pending row**

```bash
curl -s -X POST $URL -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"base_amount":500,"method":"gcash"}'
```
Expected: `{"checkout_url":"https://checkout.paymongo.com/cs_..."}`. Then in the SQL Editor:
```sql
select method, base_amount, fee_amount, charge_amount, status
from public.topups order by created_at desc limit 1;
```
Expected: `gcash | 500.00 | 12.83 | 512.83 | pending` (fee/charge reflect the estimate rate 0.025: `ceil(50000/0.975)=51283`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/create-topup-checkout/index.ts
git commit -m "feat(topup): add create-topup-checkout edge function"
```

---

## Task 3: `paymongo-webhook` edge function

**Files:**
- Create: `supabase/functions/paymongo-webhook/index.ts`

**Interfaces:**
- Consumes: `confirm_topup` RPC (Task 1); env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMONGO_WEBHOOK_SECRET`.
- Produces: public `POST` endpoint that verifies the `Paymongo-Signature` HMAC on the raw body, then credits via `confirm_topup` on `checkout_session.payment.paid`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/paymongo-webhook/index.ts`:

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Constant-time hex compare.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();               // raw body — sign/parse from THIS, not a re-serialization
  const header = req.headers.get('Paymongo-Signature') ?? '';
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')) as [string, string][]);
  const t = parts['t'];
  const expected = parts['te'];               // test-mode signature (use 'li' for live)
  if (!t || !expected) return new Response('Bad signature header', { status: 401 });

  const computed = await hmacHex(WEBHOOK_SECRET, `${t}.${raw}`);
  if (!timingSafeEqual(computed, expected)) return new Response('Bad signature', { status: 401 });

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response('Bad body', { status: 400 }); }

  const type = event?.data?.attributes?.type;
  if (type !== 'checkout_session.payment.paid') {
    return new Response('ignored', { status: 200 });
  }

  const cs = event?.data?.attributes?.data;                 // the checkout_session resource
  const sessionId: string | undefined = cs?.id;             // cs_...  (top-level id)
  const payment = cs?.attributes?.payments?.[0];            // first payment
  const paymentId: string | undefined = payment?.id;        // pay_...  (top-level id)
  const attr = payment?.attributes ?? {};
  const paidPesos = typeof attr.amount === 'number' ? attr.amount / 100 : null;
  const netPesos = typeof attr.net_amount === 'number' ? attr.net_amount / 100 : null;
  const status = attr.status;

  if (!sessionId || !paymentId || paidPesos === null) {
    console.error('[paymongo-webhook] unexpected payload shape', JSON.stringify(event));
    return new Response('ok', { status: 200 });   // acked; loud log is the alert
  }

  const { data: result, error } = await supabase.rpc('confirm_topup', {
    p_session_id: sessionId,
    p_payment_id: paymentId,
    p_paid_amount: paidPesos,
    p_net_amount: netPesos,
    p_status: status,
  });
  if (error) {
    console.error('[paymongo-webhook] confirm_topup error:', error.message);
    return new Response('rpc error', { status: 500 });   // let PayMongo retry a transient DB error
  }

  if (result === 'unknown' || result === 'amount_mismatch' || result === 'not_paid') {
    console.error(`[paymongo-webhook] session ${sessionId} → ${result}`);   // loud, alertable
  }
  return new Response(JSON.stringify({ result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
```

- [ ] **Step 2: Deploy + register + set the signing secret**

Deploy: `npx supabase functions deploy paymongo-webhook --no-verify-jwt --project-ref rgqwaiassatyruptsgbs`
In the PayMongo dashboard (test mode) → Developers → Webhooks → add endpoint `https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/paymongo-webhook`, event `checkout_session.payment.paid`. Copy the returned `whsk_…` secret and run:
`npx supabase secrets set PAYMONGO_WEBHOOK_SECRET=whsk_YOURSECRET --project-ref rgqwaiassatyruptsgbs`

- [ ] **Step 3: Verify signature rejection**

```bash
URL=https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/paymongo-webhook
curl -s -o /dev/null -w "%{http_code}\n" -X POST $URL \
  -H 'Content-Type: application/json' -H 'Paymongo-Signature: t=1,te=deadbeef,li=' \
  -d '{"data":{"attributes":{"type":"checkout_session.payment.paid"}}}'
```
Expected: `401`.

- [ ] **Step 4: Verify end-to-end credit (real test payment)**

Create a session (Task 2 Step 4), open the `checkout_url`, and complete the GCash test payment (click **Authorize** on the PayMongo test page). Then in the SQL Editor:
```sql
select status, payment_id, net_amount, paid_at from public.topups order by created_at desc limit 1;
select balance from public.profiles where id = '<provider_id>';
select type, amount, reference_id from public.transactions order by created_at desc limit 1;
```
Expected: `status = paid`, `payment_id` set, balance increased by exactly `500`, one `topup` transaction with `reference_id = payment_id`. Re-send the same event from the PayMongo dashboard → balance does **not** change again (result `duplicate`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/paymongo-webhook/index.ts
git commit -m "feat(topup): add paymongo-webhook with raw-body signature verify + confirm_topup"
```

---

## Task 4: `topup-return` https bounce function

**Files:**
- Create: `supabase/functions/topup-return/index.ts`

**Interfaces:**
- Produces: public `GET` endpoint that 302-redirects to `lpg-go://topup?status=<success|cancelled>`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/topup-return/index.ts`:

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve((req) => {
  const url = new URL(req.url);
  // Whitelist only — never reflect an arbitrary param into the Location header.
  const status = url.searchParams.get('status') === 'success' ? 'success' : 'cancelled';
  const target = `lpg-go://topup?status=${status}`;

  const html = `<!doctype html><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${target}">
<title>Returning to LPG Go…</title>
<body style="font-family:sans-serif;text-align:center;padding:2rem">
<p>Returning to the app…</p>
<p><a href="${target}">Tap here if it doesn't open automatically.</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body>`;

  return new Response(html, {
    status: 302,
    headers: { Location: target, 'Content-Type': 'text/html; charset=utf-8' },
  });
});
```

- [ ] **Step 2: Deploy**

Run: `npx supabase functions deploy topup-return --no-verify-jwt --project-ref rgqwaiassatyruptsgbs`

- [ ] **Step 3: Verify the redirect**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  "https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/topup-return?status=success"
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  "https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/topup-return?status=haxxor"
```
Expected: `302 lpg-go://topup?status=success` and `302 lpg-go://topup?status=cancelled` (anything but `success` normalizes to `cancelled`).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/topup-return/index.ts
git commit -m "feat(topup): add topup-return https bounce to app scheme"
```

---

## Task 5: `topup.tsx` — real checkout + Maya + poll

**Files:**
- Modify: `app/(provider)/topup.tsx`
- Modify: `package.json` (adds `expo-web-browser`)

**Interfaces:**
- Consumes: `create-topup-checkout` (Task 2), `topups` table SELECT (Task 1), the app scheme `lpg-go` (bounce, Task 4).

- [ ] **Step 1: Install expo-web-browser**

Run: `npx expo install expo-web-browser`
Expected: `package.json` gains `expo-web-browser`; lockfile updated.

- [ ] **Step 2: Update imports, method type, and constants**

In `app/(provider)/topup.tsx`, add the import and replace the `PaymentMethod` type + `PRESETS`:

```ts
import * as WebBrowser from 'expo-web-browser';
```

```ts
type PaymentMethod = 'gcash' | 'paymaya' | 'card';

const H_PADDING = 20;
const PRESETS = [500, 1000, 2000, 5000];
const MIN_FALLBACK = 300;
const MAX_FALLBACK = 50000;
const FUNCTIONS_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1';
```

- [ ] **Step 3: Replace settings state + `fetchSettings` to load fee config and per-method flags**

Replace the `allowCard` state and `fetchSettings` with:

```ts
const [settings, setSettings] = useState<{
  feeRate: Record<PaymentMethod, number>;
  feeFixedCard: number;
  allow: Record<PaymentMethod, boolean>;
  min: number;
  max: number;
} | null>(null);
```

```ts
async function fetchSettings() {
  const { data } = await supabase
    .from('platform_settings')
    .select('fee_rate_gcash, fee_rate_maya, fee_rate_card, fee_fixed_card, allow_gcash_topup, allow_maya_topup, allow_card_topup, topup_min_amount, topup_max_amount')
    .single();
  if (!data) return;
  setSettings({
    feeRate: { gcash: Number(data.fee_rate_gcash), paymaya: Number(data.fee_rate_maya), card: Number(data.fee_rate_card) },
    feeFixedCard: Number(data.fee_fixed_card),
    allow: { gcash: data.allow_gcash_topup, paymaya: data.allow_maya_topup, card: data.allow_card_topup },
    min: Number(data.topup_min_amount) || MIN_FALLBACK,
    max: Number(data.topup_max_amount) || MAX_FALLBACK,
  });
}
```

- [ ] **Step 4: Add the client-side charge preview (display only)**

Add this helper above the component's `return` (mirrors the server's integer-centavo math):

```ts
function computeCharge(base: number, method: PaymentMethod): { charge: number; fee: number } | null {
  if (!settings) return null;
  const baseC = Math.round(base * 100);
  if (baseC / 100 !== base) return null;
  const fixedC = method === 'card' ? Math.round(settings.feeFixedCard * 100) : 0;
  const rate = settings.feeRate[method];
  if (!(rate >= 0 && rate < 1)) return null;
  const chargeC = Math.ceil((baseC + fixedC) / (1 - rate));
  return { charge: chargeC / 100, fee: (chargeC - baseC) / 100 };
}
```

- [ ] **Step 5: Replace the "coming soon" `processTopUp` with the real launch + poll**

Replace `processTopUp` (and the `handleProceed` call into it) with:

```ts
async function handleProceed() {
  const amount = getAmount();
  const min = settings?.min ?? MIN_FALLBACK;
  if (!amount || amount < min) {
    Alert.alert('Invalid Amount', `Minimum top-up amount is ${peso(min)}.`);
    return;
  }
  if (amount > (settings?.max ?? MAX_FALLBACK)) {
    Alert.alert('Invalid Amount', `Maximum top-up amount is ${peso(settings!.max)}.`);
    return;
  }
  setProcessing(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { Alert.alert('Session expired', 'Please log in again.'); return; }

    const res = await fetch(`${FUNCTIONS_URL}/create-topup-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ base_amount: amount, method: paymentMethod }),
    });
    const json = await res.json();
    if (!res.ok || !json.checkout_url || !json.topup_id) {
      Alert.alert('Top-up failed', json.error ?? 'Could not start payment.');
      return;
    }

    await WebBrowser.openAuthSessionAsync(json.checkout_url, 'lpg-go://topup');

    // Regardless of the result type (success/cancel/dismiss), the DB status is
    // the source of truth — a paid top-up can return as 'dismiss'. Poll THIS row.
    await pollForCredit(json.topup_id);
  } catch (e) {
    Alert.alert('Top-up failed', 'Network error. If you completed payment, your balance will update shortly.');
  } finally {
    setProcessing(false);
  }
}

async function pollForCredit(topupId: string) {
  if (!userId) return;
  for (let i = 0; i < 10; i++) {          // ~10 × 1.5s = 15s
    const { data } = await supabase
      .from('topups')
      .select('status')
      .eq('id', topupId)
      .single();
    if (data?.status === 'paid') {
      await fetchBalance(userId);
      Alert.alert('Top-up successful', 'Your balance has been updated.');
      return;
    }
    if (data?.status === 'failed') {
      Alert.alert('Top-up failed', 'The payment could not be verified. You were not charged for credit.');
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  Alert.alert('Still confirming', 'If you completed payment, your balance will update shortly.');
}
```

- [ ] **Step 6: Update the payment-method picker (add Maya; gate by the new flags) and remove the "coming soon" banner**

Replace the payment-options block and the coming-soon banner in the JSX:

```tsx
{/* Payment method */}
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Payment Method</Text>
  <View style={styles.paymentOptions}>
    {settings?.allow.gcash !== false && (
      <PaymentOption label="GCash" sub="Pay via GCash e-wallet" icon="smartphone"
        selected={paymentMethod === 'gcash'} onPress={() => setPaymentMethod('gcash')} />
    )}
    {settings?.allow.paymaya && (
      <PaymentOption label="Maya" sub="Pay via Maya e-wallet" icon="smartphone"
        selected={paymentMethod === 'paymaya'} onPress={() => setPaymentMethod('paymaya')} />
    )}
    {settings?.allow.card && (
      <PaymentOption label="Card" sub="Visa / Mastercard / debit" icon="credit-card"
        selected={paymentMethod === 'card'} onPress={() => setPaymentMethod('card')} />
    )}
  </View>
</View>
```

Delete the `<View style={styles.comingSoon}>…</View>` block and its now-unused styles (`comingSoon`, `comingSoonText`, `comingSoonTitle`, `comingSoonSub`).

- [ ] **Step 7: Show the charge summary above the bottom bar**

Add, just before the `{/* Info note */}` card:

```tsx
{isValidAmount && settings && (() => {
  const c = computeCharge(amount!, paymentMethod);
  return c ? (
    <Card style={styles.infoBox}>
      <Feather name="info" size={14} color={colors.textSecondary} style={{ marginTop: 1 }} />
      <Text style={styles.infoText}>
        You'll pay {peso(c.charge)} ({peso(amount!)} + {peso(c.fee)} fee). ₱1 = 1 credit; the full {peso(amount!)} is added to your balance.
      </Text>
    </Card>
  ) : null;
})()}
```

Also update the minimum-note copy to read the setting: `Minimum top-up: {peso(settings?.min ?? MIN_FALLBACK)}`.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. (If `paymentMethod` state was typed to the old union, confirm it now accepts `'paymaya'`.)

- [ ] **Step 9: App walk-through (the real verification)**

Run `npx expo start`, log in as dealer `09000000002`, open Top Up:
- GCash + Maya show; Card shows only if `allow_card_topup` is true. Presets are 500/1k/2k/5k; min copy says ₱300.
- Pick ₱500 + GCash → the summary reads "You'll pay ₱512.83 (₱500.00 + ₱12.83 fee)".
- Tap Request → PayMongo checkout opens → complete the GCash **test** authorization → the browser returns → "Confirming…" → "Top-up successful", balance +₱500 on the Earnings screen.
- Tap Request then cancel on PayMongo → returns to the form, no credit.

- [ ] **Step 10: Commit**

```bash
git add app/(provider)/topup.tsx package.json package-lock.json
git commit -m "feat(topup): wire topup screen to PayMongo checkout (gcash/maya/card) with poll"
```

---

## Task 6: Finish the branch

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit` — expected 0 errors.

- [ ] **Step 2: Codex review of the implementation**

Invoke `/codex-review` (PHASE mode auto-selects from the commit count) and fix Critical/Important findings.

- [ ] **Step 3: Open the PR**

Use the `create-pr` skill (runs the diff-scoped review gate: dry-checker, security-reviewer, api-checker, general-code-reviewer). Do **not** merge — hand off to the user to run `/merge-pr`.

---

## Notes for the executor

- **Pending real numbers:** the `fee_rate_*` / `fee_fixed_card` defaults are ESTIMATES. Before go-live, run the 4 PayMongo test probes (spec §9), read `payments[0].attributes.{amount,fee,net_amount}`, and `UPDATE public.platform_settings SET fee_rate_gcash=…, fee_rate_maya=…, fee_rate_card=…, fee_fixed_card=… WHERE id=1;` with the measured VAT-inclusive values. No schema change — the fee harness numbers in Task 2 Step 4 assume the 0.025 estimate and shift if the rate changes.
- **Pending security read:** run the `pg_policies` check on `profiles` (spec §2c) to confirm the `anon` REVOKE closed a real hole vs defense-in-depth. The REVOKE ships regardless.
- **Live vs test:** everything above targets PayMongo **test** keys on the **dev** Supabase project. Swapping to live = new secrets + the webhook's `te` → `li` signature component + a re-registered live webhook.
- **`getAmount` / `isValidAmount`** already exist in the file and are reused unchanged.
