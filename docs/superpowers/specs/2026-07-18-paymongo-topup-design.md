# PayMongo Provider Top-Up — Design Spec

**Date:** 2026-07-18
**Status:** Approved for implementation (pending investigate-first pass)
**Feature:** Wire the provider "Top Up Balance" screen to real online payments via PayMongo (GCash, Maya, and card/debit), replacing the current "coming soon" stub.

---

## 1. Goal

Let an approved provider add real balance to `profiles.balance` by paying through PayMongo. The provider chooses an amount and a method **in the app**, pays on a PayMongo-hosted checkout page locked to that method, and their balance is credited **only after** PayMongo confirms the payment via webhook. The provider shoulders the PayMongo transaction fee.

Non-goals (this spec): withdrawals/payouts, refunds, customer-side online payments, admin UI for the new settings (admin repo owns that separately), saved payment methods, recurring top-ups.

---

## 2. Locked decisions

These were settled during brainstorming. Do not relitigate:

1. **Gross-credit, per-method fee.** Provider is charged `base + fee`; the full `base` lands in balance. Because the method is chosen in-app, the fee is deterministic at charge time. **`charge = ceil((base + fixed) / (1 − rate))`**, **`credit = base` exactly**. Ceil rounding means any rounding drift is a sub-centavo platform surplus, never a loss — the platform is fee-neutral.
2. **Hosted Checkout Session, one method per session.** Provider picks GCash / Maya / Card in-app; we create a PayMongo Checkout Session locked to that single method (`payment_method_types: [method]`) and open it with `expo-web-browser`. No card data touches the app (PayMongo handles PCI, OTP, 3DS).
3. **Fee rates live in `platform_settings`** (admin-editable), consistent with the existing `allow_card_payment` precedent.
4. **Amounts stored in pesos** (`numeric(10,2)`, matching `transactions.amount`); converted to **centavos** only at the PayMongo API boundary.
5. **Migration `088`**, applied **manually** via the Supabase SQL Editor. Never `supabase db push` (see `NEXT.md` — the ledger is stale and a push would replay ~50 applied migrations out of order and wreck the DB).

### 2a. Amounts, minimum, presets (revised)

- **Minimum top-up: ₱300** (not ₱50). At ₱50 the card fixed fee is ~30% of the charge and it doesn't clear `min_balance` anyway.
- **Presets: ₱500 / ₱1,000 / ₱2,000 / ₱5,000** (drop ₱100 and ₱200 from the current `PRESETS`).
- Min/max are stored as `topup_min_amount` (default 300) and `topup_max_amount` (sanity ceiling) in `platform_settings`; the client reads them (with a hardcoded fallback) and the edge function **re-validates authoritatively**.

### 2b. Provider top-up method flags are SEPARATE from customer payment flags (revised)

`allow_card_payment` and `allow_cash_payment` are **customer-facing** — read in `app/(customer)/order/[id].tsx:253` and `app/(customer)/find-store/[productId].tsx:276` to drive the customer's *order* payment method. The current `topup.tsx:63` **piggybacks on `allow_card_payment`**, a latent cross-wire: turning off customer card payments would silently kill provider card top-ups.

**Fix:** introduce independent provider-top-up flags and switch `topup.tsx` to them:

- `allow_gcash_topup` (default `true`)
- `allow_maya_topup` (default `true`)
- `allow_card_topup` (default `true`) — replaces the `allow_card_payment` read in `topup.tsx`

GCash/Maya/Card top-up availability is now controlled independently of the customer order-payment settings.

---

## 3. Migration `088` (single file, applied manually)

`supabase/migrations/20240101000088_paymongo_topup.sql`. **Before applying, eyeball the live DB** to confirm `088` is unused (file union across mobile+admin says highest applied is `087`; the ledger is stale and not authoritative).

### 3.1 `platform_settings` columns (single row, `id = 1`)

```sql
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS fee_rate_gcash    numeric(6,4)   NOT NULL DEFAULT 0.025,  -- 2.5%
  ADD COLUMN IF NOT EXISTS fee_rate_maya     numeric(6,4)   NOT NULL DEFAULT 0.020,  -- 2.0%
  ADD COLUMN IF NOT EXISTS fee_rate_card     numeric(6,4)   NOT NULL DEFAULT 0.035,  -- 3.5%
  ADD COLUMN IF NOT EXISTS fee_fixed_card    numeric(10,2)  NOT NULL DEFAULT 15,     -- ₱15 fixed, card only
  ADD COLUMN IF NOT EXISTS allow_gcash_topup boolean        NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_maya_topup  boolean        NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_card_topup  boolean        NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS topup_min_amount  numeric(10,2)  NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS topup_max_amount  numeric(10,2)  NOT NULL DEFAULT 50000;
```

> Default rates are placeholders reflecting PayMongo's published rates at design time; admin confirms actuals before go-live. All rate columns are admin-editable.

### 3.2 `topups` table (pending ledger + idempotency)

```sql
CREATE TABLE public.topups (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  method               text        NOT NULL CHECK (method IN ('gcash','paymaya','card')),
  base_amount          numeric(10,2) NOT NULL CHECK (base_amount > 0),   -- credited on success
  fee_amount           numeric(10,2) NOT NULL CHECK (fee_amount >= 0),
  charge_amount        numeric(10,2) NOT NULL CHECK (charge_amount > 0), -- what PayMongo charges
  checkout_session_id  text        NOT NULL UNIQUE,                      -- PayMongo cs_...
  payment_id           text,                                            -- PayMongo pay_...
  status               text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','paid','failed','expired')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  paid_at              timestamptz
);
ALTER TABLE public.topups ENABLE ROW LEVEL SECURITY;
```

**RLS / grants:**
- Provider may `SELECT` **own** rows (`provider_id = auth.uid()`) — the client polls its own top-up status after returning from checkout.
- **No client `INSERT`/`UPDATE`/`DELETE`.** All writes are service-role (edge functions) only. Revoke write grants from `authenticated`/`anon`, mirroring the `orders`/`order_acceptances` lockdown pattern (migrations 057/080).
- `UNIQUE(checkout_session_id)` is a hard idempotency key against duplicate webhook delivery.

### 3.3 `confirm_topup(...)` — `SECURITY DEFINER` credit function

Mirrors the existing credit pattern (`handle_order_delivered` in migration 024, `grant_signup_promo` in 048): bump balance + insert a `transactions` row, atomically, with a pinned `search_path`.

```sql
CREATE OR REPLACE FUNCTION public.confirm_topup(
  p_session_id text,
  p_payment_id text,
  p_net_amount numeric  -- from PayMongo, for reconciliation/logging only
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topup public.topups%ROWTYPE;
BEGIN
  -- Lock the row; idempotent no-op if missing or already terminal.
  SELECT * INTO v_topup FROM public.topups
    WHERE checkout_session_id = p_session_id
    FOR UPDATE;

  IF NOT FOUND OR v_topup.status <> 'pending' THEN
    RETURN;  -- unknown session or already processed → no double-credit
  END IF;

  UPDATE public.topups
    SET status = 'paid', payment_id = p_payment_id, paid_at = now()
    WHERE id = v_topup.id;

  UPDATE public.profiles
    SET balance = balance + v_topup.base_amount
    WHERE id = v_topup.provider_id;

  INSERT INTO public.transactions (provider_id, type, amount, reference_id)
    VALUES (v_topup.provider_id, 'topup', v_topup.base_amount, p_payment_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_topup(text, text, numeric) FROM public, anon, authenticated;
-- service_role bypasses grants; the webhook (service-role client) is the only caller.
```

- **Credit = `base_amount`** (deterministic — method known at charge time). `p_net_amount` is stored/logged for reconciliation, not used to compute the credit.
- `transaction_type` already has the `'topup'` value (initial schema) — **no enum change needed**.
- `transactions.reference_id` (existing `text` column) holds the PayMongo `payment_id`.

---

## 4. Edge function: `create-topup-checkout`

`supabase/functions/create-topup-checkout/index.ts` — follows the `send-otp` structure (Deno, `serve`, service-role client, `Deno.env.get`, CORS, redacted logging).

**Auth:** requires an `Authorization: Bearer <access_token>` header (the provider's session JWT). Resolve the user with `supabase.auth.getUser(jwt)`; reject if not an **approved provider** (`role = 'provider'` and `is_approved`).

**Input:** `{ base_amount: number, method: 'gcash' | 'paymaya' | 'card' }`.

**Server-side validation (authoritative — never trust the client for money):**
1. `method` is one of the three literals **and** its `allow_*_topup` flag is `true`.
2. `base_amount` is a positive number, `>= topup_min_amount`, `<= topup_max_amount`.

**Charge computation (server-side, in centavos):**
```
rate  = fee_rate_gcash | fee_rate_maya | fee_rate_card   (per method)
fixed = (method === 'card') ? fee_fixed_card : 0
charge = ceil((base + fixed) / (1 - rate))   // pesos, ceil to the centavo
fee    = charge - base
```

**Create the PayMongo Checkout Session** (`POST https://api.paymongo.com/v1/checkout_sessions`, HTTP Basic auth with `PAYMONGO_SECRET_KEY`):
- `line_items: [{ amount: charge_centavos, currency: 'PHP', name: 'LPG Go balance top-up', quantity: 1 }]`
- `payment_method_types: [method]` (locks the page to the chosen method)
- `success_url: 'lpg-go://topup?status=success'`, `cancel_url: 'lpg-go://topup?status=cancelled'`
- `description`, `reference_number: <topup uuid>`, `metadata: { topup_id, provider_id }`

**Then** insert the `pending` `topups` row (`checkout_session_id` = returned `cs_...`, plus `base_amount`/`fee_amount`/`charge_amount`/`method`/`provider_id`) and return `{ checkout_url }`.

**Secrets:** `PAYMONGO_SECRET_KEY` (`sk_test_...` first). Never committed; set via Supabase secrets.

---

## 5. Edge function: `paymongo-webhook`

`supabase/functions/paymongo-webhook/index.ts` — **public** (no JWT; PayMongo calls it).

**Signature verification is mandatory and first.** Without it, anyone who knows the URL could POST a forged `paid` event and mint balance. PayMongo sends `Paymongo-Signature: t=<ts>,te=<test_sig>,li=<live_sig>`. Compute `HMAC-SHA256(key = PAYMONGO_WEBHOOK_SECRET, msg = "<t>.<rawBody>")` using Deno's Web Crypto, and constant-time compare against the environment's signature component (`te` for test keys, `li` for live). Mismatch → `401`, no side effects. Verify against the **raw** request body (parse JSON only after the check).

**On `checkout_session.payment.paid`:**
- Extract the checkout session id, the `payment_id`, and the payment's `net_amount` from the event payload.
- Call `confirm_topup(session_id, payment_id, net_amount)` via the service-role client.
- Return `200` on success **and** on idempotent duplicates (so PayMongo stops retrying).

**Other event types:** acknowledge with `200` (ignored). Unparseable body → `400`. Bad signature → `401`.

**Registration:** register the deployed function URL as a PayMongo webhook for `checkout_session.payment.paid`. Store the returned signing secret as `PAYMONGO_WEBHOOK_SECRET`.

---

## 6. Mobile: `app/(provider)/topup.tsx`

- **Method type:** `type PaymentMethod = 'gcash' | 'paymaya' | 'card'`. Add a **Maya** option to the picker. GCash always shown; Maya gated by `allow_maya_topup`; Card gated by **`allow_card_topup`** (not `allow_card_payment`).
- **Presets:** `[500, 1000, 2000, 5000]`. **Minimum:** ₱300 (read `topup_min_amount`/`topup_max_amount` from settings, fallback 300 / 50000). Update the "Minimum top-up" copy.
- **`fetchSettings`** also selects the fee-rate columns + the three `allow_*_topup` flags + min/max.
- **Charge summary (display only):** compute the charge client-side with the fetched rates and show *"You'll pay ₱X (₱base + ₱fee fee)"* under the amount. The edge function recomputes authoritatively — the client number is a preview.
- **`handleProceed`** (replaces the `processTopUp` "coming soon" stub):
  1. `POST` to `https://<ref>.supabase.co/functions/v1/create-topup-checkout` with the session's `Authorization: Bearer` header and `{ base_amount, method }` (raw `fetch`, matching the existing `send-otp` call convention — the app does **not** use `supabase.functions.invoke`).
  2. `WebBrowser.openAuthSessionAsync(checkout_url, 'lpg-go://topup')`.
  3. On return, enter a **"Confirming payment…"** state; refresh `balance` and **poll the `topups` row** (its own RLS-visible row) until `status = 'paid'` (or a short timeout), because the credit is webhook-driven and may lag 1–2s. On `paid`, show success and the new balance. `cancelled`/dismiss → back to the form. (The Earnings screen already subscribes to `transactions` realtime, so its history updates on its own.)
- **Remove** the amber "coming soon" banner.
- **Package:** add `expo-web-browser` via `npx expo install expo-web-browser`. (`expo-linking` ~8 is already installed; app `scheme` is `lpg-go`.)

---

## 7. Security invariants (the whole point)

1. **Charge and fee are computed server-side only.** The client sends `base_amount` + `method`; both are re-validated and the charge is recomputed in the edge function.
2. **Balance is credited only by `confirm_topup`, called only by the webhook, only after signature verification.** `profiles.balance` is already client-write-locked (migration 057); `topups` writes are service-role only.
3. **Idempotent by construction:** `confirm_topup`'s `status = 'pending'` guard under `FOR UPDATE` + `UNIQUE(topups.checkout_session_id)` → a replayed or duplicated webhook credits exactly once.
4. **Webhook signature verification is non-optional** and runs before any parsing or side effect.
5. **No secrets in the repo.** `PAYMONGO_SECRET_KEY` / `PAYMONGO_WEBHOOK_SECRET` live in Supabase function secrets. Build against **test keys on the dev project** first; swap to live at launch.

---

## 8. Verification (no test runner in this repo)

Per `stack.md`, "tests green" means `tsc` at 0 + a real app walk-through. In PayMongo **test mode**:

1. **Happy path:** provider tops up ₱500 via GCash test flow → returns to app → `topups.status` flips to `paid` → balance increases by exactly ₱500 → one `topup` transaction row with the PayMongo `payment_id` as `reference_id`.
2. **Idempotency:** re-deliver the same webhook (PayMongo dashboard "resend", or replay the captured payload) → balance does **not** change a second time.
3. **Forgery:** POST an unsigned / wrong-signature body to the webhook → `401`, no `topups`/balance change.
4. **Fee math:** charged amount matches `ceil((base + fixed)/(1 − rate))` for each method; credited amount equals `base`.
5. **Flag isolation:** toggling `allow_card_payment` (customer flag) does **not** change provider card-top-up availability; only `allow_card_topup` does.
6. `tsc --noEmit` at 0 (regenerate `lib/database.types.ts` after the migration so `topups` + the new settings columns are typed).

---

## 9. Implementation order (investigate-first)

1. **Investigate** the live DB / both repos to confirm `088` is free and re-confirm the `platform_settings` shape and PayMongo's current published rates.
2. Migration `088` (settings columns, `topups`, `confirm_topup`) — write the file; apply manually via SQL Editor; regenerate `database.types.ts`.
3. `create-topup-checkout` edge function.
4. `paymongo-webhook` edge function; register it in PayMongo; set both secrets.
5. `topup.tsx` rewrite (method picker + Maya, presets/min, charge summary, checkout launch, confirming/poll state).
6. Verify per §8; then `/codex-review` before finishing the branch (per the workflow rule).
