# PayMongo Provider Top-Up — Design Spec

**Date:** 2026-07-18 (investigation folded in 2026-07-19)
**Status:** Approved; investigate-first pass mostly complete (pending only: empirical fee rates from 4 test probes, and the `profiles` RLS-policy read).
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

### 2c. Investigation results (dev DB + PayMongo docs, 2026-07-19)

Confirmed against the live **dev** DB and official PayMongo docs:

- **`088` is free** — migration ledger is stuck at `…029` (stale, as `NEXT.md` warned); `to_regclass('public.topups')` is null and no `confirm_topup` exists. Object-collision check, not ledger trust.
- **Schema assumptions hold** — `platform_settings` is single-row `id=1` and has none of the new columns; `transactions` has `reference_id text` + nullable `order_id`; `transaction_type` already has `topup`; `profiles.is_approved` exists and is `NOT NULL`.
- **`allow_card_payment` is currently `false`; `min_balance` is ₱200.** ⚠️ **Behavior change on apply:** since `allow_card_topup` defaults `true`, provider card top-up goes live *independently* of the (currently-off) customer card flag — this is the intended decoupling, called out so it isn't a surprise. ₱300 min clears the ₱200 `min_balance`.
- **PayMongo method identifiers confirmed:** `gcash`, `paymaya`, `card`. Amounts in **centavos**. `metadata` values must be **strings**.
- **Fee/VAT resolved:** PayMongo pricing is **VAT-exclusive** (GCash 2.23%, Maya 1.79%, card 3.125% + ₱13.39); the payment resource's **`fee` field is VAT-inclusive** (`taxes[].inclusive:true`) and **`net_amount = amount − fee`**. Headline ×1.12 → **~2.5% / ~2.0% / ~3.5% + ₱15**, matching the spec defaults. Empirical confirmation via the 4 probes is still pending.
- **Redirect scheme (decided): Option A — https bounce page.** PayMongo does **not** document custom-scheme (`lpg-go://`) redirect URLs; the documented mobile pattern is https + WebView interception. We use an **https bounce page** (see §5b) instead. (WebView/native-dep and no-auto-return were rejected.)
- **Webhook facts corrected:** signing-secret prefix is **`whsk_`** (not `whsec_`); pin to **`/v1/checkout_sessions`** (its webhook envelope matches our assumed paths; v2's is flatter).

**Open security item (pre-existing, pending decision):** dev grants show **`anon` still holds table-level `UPDATE`/`DELETE`/`TRUNCATE` on `profiles`** (migration 057 revoked those from `authenticated` only). `authenticated` correctly has **no** `UPDATE` on `balance`, so the feature's core premise holds — but the anon grant is a latent second write-path on the very column we're about to start crediting. This migration adds a defensive `REVOKE … FROM anon` (see §3.4); the `profiles` RLS-policy read that decides whether this is exploitable-now vs defense-in-depth is still pending.

---

## 3. Migration `088` (single file, applied manually)

`supabase/migrations/20240101000088_paymongo_topup.sql`. **`088` confirmed free** (see §2c — no `topups`/`confirm_topup` objects; ledger stale at `029` and not authoritative).

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

> Defaults are the **effective (VAT-inclusive) rates** — PayMongo's VAT-exclusive pricing (2.23% / 1.79% / 3.125% + ₱13.39) ×1.12 ≈ these values (see §2c). They are **confirmed empirically** by the 4 test probes in the §9 investigate step before go-live; the `fee` field PayMongo returns is already VAT-inclusive, so the derived rate drops straight into these columns. All rate columns are admin-editable.
>
> **Naming:** `'paymaya'` is the correct PayMongo `payment_method_types` identifier and is used as the DB `method` value; the column is `fee_rate_maya` and the UI label is "Maya". The `'paymaya' → fee_rate_maya` lookup is a deliberate mapping, not a string match — write it explicitly.

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
  net_amount           numeric(10,2),                                   -- actual settled amount from PayMongo (set on paid)
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
  p_net_amount numeric  -- actual settled amount from PayMongo (fee already deducted)
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

  -- Reconciliation guard: if PayMongo settled LESS than the base we're about to
  -- credit, the configured fee rate under-estimated the real (VAT-inclusive)
  -- rate and the platform is eating the gap. Persist net_amount and log it so
  -- the drift is detectable instead of silent. (We still credit base — the
  -- provider was promised it — but this must be watched and the rate corrected.)
  IF p_net_amount IS NOT NULL AND p_net_amount < v_topup.base_amount THEN
    -- NOTE: single % is the RAISE value placeholder; %% would be a literal
    -- percent and consume no argument (→ "too many parameters" error here).
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_topup(text, text, numeric) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_topup(text, text, numeric) TO service_role;  -- explicit; the webhook is the only caller
```

- **Credit = `base_amount`** (deterministic — method known at charge time). `p_net_amount` is now **persisted** to `topups.net_amount` and compared against base for drift detection — it is not used to compute the credit.
- `transaction_type` already has the `'topup'` value (initial schema) — **no enum change needed**.
- `transactions.reference_id` (existing `text` column) holds the PayMongo `payment_id`.

> **VAT caveat (fee-neutrality depends on this).** PayMongo's pricing is VAT-**exclusive**, but the **`fee` field on the payment resource is VAT-inclusive** (`taxes[].inclusive:true`), and `net_amount = amount − fee`. So the `fee_rate_*` columns must hold the **effective VAT-inclusive rate** (the spec defaults already do). If a rate is under-configured, `net < base` on that top-up and the platform silently absorbs the gap — the `net_amount` persistence + `RAISE WARNING` above is the safety net that makes that visible.

### 3.4 Defensive hardening — revoke leftover `anon` writes on `profiles`

Migration 057 revoked `UPDATE/DELETE/TRUNCATE` on `profiles` from `authenticated` only; the dev DB shows **`anon` still holds those table-level grants** (§2c), including on `balance`. `authenticated` is correctly locked, so the feature's premise holds — but since `088` starts crediting real money into `balance`, close the second write-path at the grant level too (RLS is the primary boundary; this is defense-in-depth, mirroring 057):

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON public.profiles FROM anon;
```

> Exploitability (is any `profiles` RLS policy actually open to `anon` UPDATE?) is being confirmed by a pending `pg_policies` read. The `REVOKE` is safe and correct regardless — a client never legitimately writes `profiles` as `anon`.

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

**Pre-generate the topup id.** `reference_number` / `metadata.topup_id` must reference the row's id, but the session is created before the row is inserted — so the edge function generates the uuid itself (`crypto.randomUUID()`) and inserts the `topups` row with an **explicit `id`**, rather than relying on the table's `DEFAULT gen_random_uuid()`. (The credit path keys off `checkout_session_id`, so `metadata`/`reference_number` are convenience/traceability only — but they still need a real id.)

**Create the PayMongo Checkout Session** (`POST https://api.paymongo.com/v1/checkout_sessions`, HTTP Basic auth `-u sk_...:` — secret as username, empty password), body under `data.attributes`:
- `line_items: [{ amount: charge_centavos, currency: 'PHP', name: 'LPG Go balance top-up', quantity: 1 }]` (amount in **centavos**, integer)
- `payment_method_types: [method]` (locks the page to the chosen method)
- `success_url`/`cancel_url` → the **https bounce page** (§5b), e.g. `https://<ref>.supabase.co/functions/v1/topup-return?status=success` / `?status=cancelled` (custom schemes are not supported — §2c).
- `description`, `reference_number: <pre-generated topup id>`, `metadata: { topup_id, provider_id }` (**metadata values must be strings**)

Response field paths (confirmed): session id at **`data.id`** (`cs_…`), hosted URL at **`data.attributes.checkout_url`**.

**Then** insert the `pending` `topups` row (explicit `id`, `checkout_session_id` = `data.id`, plus `base_amount`/`fee_amount`/`charge_amount`/`method`/`provider_id`) and return `{ checkout_url }`.

> **Ordering / failure handling.** If the PayMongo call fails, no row is written (nothing to clean up). If the row insert fails *after* the session is created, the session is simply abandoned (never paid → no credit); log and return an error to the client. Never insert the row before we have a `checkout_session_id`.

**Secrets:** `PAYMONGO_SECRET_KEY` (`sk_test_...` first). Never committed; set via Supabase secrets.

**Deploy note:** both new functions must be deployed with **JWT verification OFF** (`verify_jwt = false` / dashboard toggle) — the webhook receives no JWT, and `create-topup-checkout` does its **own** `getUser(jwt)` check. This matches how `send-otp` is already deployed (it works with no `Authorization` header).

---

## 5. Edge function: `paymongo-webhook`

`supabase/functions/paymongo-webhook/index.ts` — **public** (no JWT; PayMongo calls it).

**Signature verification is mandatory and first.** Without it, anyone who knows the URL could POST a forged `paid` event and mint balance. PayMongo sends `Paymongo-Signature: t=<ts>,te=<test_sig>,li=<live_sig>`. Compute `HMAC-SHA256(key = PAYMONGO_WEBHOOK_SECRET, msg = "<ts>.<rawBody>")` using Deno's Web Crypto, and constant-time compare against the environment's signature component (**`te` for test, `li` for live**). Mismatch → `401`, no side effects. Verify against the **raw** request body (parse JSON only after the check). The signing secret is prefixed **`whsk_`**.

**On `checkout_session.payment.paid`** (pin to the **v1** envelope — ⚠️ **mandatory**: capture one real delivered test event and confirm these exact paths before writing the parser; they are load-bearing for crediting):
- Checkout session id: `data.attributes.data.id` (`cs_…`) — resource `id` is **top-level**, a sibling of `attributes`.
- Payment id: `data.attributes.data.attributes.payments[0].id` (`pay_…`) — likewise **top-level on the payment object**, NOT under its `attributes`.
- Payment money/status: `data.attributes.data.attributes.payments[0].attributes.{net_amount, fee, amount, status}` (all **centavos**).
- Call `confirm_topup(session_id, payment_id, net_amount_in_pesos)` via the service-role client (convert centavos → pesos at this boundary).
- Return `200` on success **and** on idempotent duplicates (so PayMongo stops retrying).

**Other event types:** acknowledge with `200` (ignored). Unparseable body → `400`. Bad signature → `401`.

**Registration:** register the deployed function URL as a PayMongo webhook for `checkout_session.payment.paid` (dashboard, once). Store the returned `whsk_…` signing secret as `PAYMONGO_WEBHOOK_SECRET`.

> **Abandoned / expired sessions (forward-note).** Only `checkout_session.payment.paid` is handled, so a session the provider abandons stays `pending` forever. This is **not** a money risk (never credited) and the client poll times out cleanly — but `topups` accumulates stale rows. Follow-up (not in this slice): a periodic sweep that marks old `pending` rows `expired`, or handle a PayMongo expiry event if one exists.

---

## 5b. Edge function: `topup-return` (https bounce page)

`supabase/functions/topup-return/index.ts` — **public** (no JWT). PayMongo requires `http(s)` redirect URLs and does not support custom schemes (§2c), so this tiny function is the `success_url`/`cancel_url` target. It returns a minimal **HTML page that immediately redirects to the app scheme**, which lets `WebBrowser.openAuthSessionAsync` auto-close:

- `GET /functions/v1/topup-return?status=success|cancelled` → **`302` with `Location: lpg-go://topup?status=<status>`**. A `302` to the callback scheme is what `ASWebAuthenticationSession` / Android Custom Tabs intercept most reliably; a client-side `window.location`/`<meta refresh>` to a custom scheme is the part most likely to be gesture-blocked. Include an HTML body too (JS redirect **+ a prominent manual "Return to app" link**) as the fallback for clients that don't follow the 302 to a custom scheme.
- Pass through only a whitelisted `status` (`success`/`cancelled`) — never reflect arbitrary query params into the page or the `Location` header (avoid an open-redirect / injection surface).
- No secrets, no DB access — it is pure presentation. Credit still happens exclusively via the webhook; this page is UX-only, so a blocked redirect never loses money (the client poll below still confirms).

---

## 6. Mobile: `app/(provider)/topup.tsx`

- **Method type:** `type PaymentMethod = 'gcash' | 'paymaya' | 'card'`. Add a **Maya** option to the picker. GCash always shown; Maya gated by `allow_maya_topup`; Card gated by **`allow_card_topup`** (not `allow_card_payment`).
- **Presets:** `[500, 1000, 2000, 5000]`. **Minimum:** ₱300 (read `topup_min_amount`/`topup_max_amount` from settings, fallback 300 / 50000). Update the "Minimum top-up" copy.
- **`fetchSettings`** also selects the fee-rate columns + the three `allow_*_topup` flags + min/max.
- **Charge summary (display only):** compute the charge client-side with the fetched rates and show *"You'll pay ₱X (₱base + ₱fee fee)"* under the amount. The edge function recomputes authoritatively — the client number is a preview.
- **`handleProceed`** (replaces the `processTopUp` "coming soon" stub):
  1. `POST` to `https://<ref>.supabase.co/functions/v1/create-topup-checkout` with the session's `Authorization: Bearer` header and `{ base_amount, method }` (raw `fetch`, matching the existing `send-otp` call convention — the app does **not** use `supabase.functions.invoke`).
  2. `WebBrowser.openAuthSessionAsync(checkout_url, 'lpg-go://topup')`.
  3. **On ANY return type (`success`, `cancel`, or `dismiss`), enter "Confirming payment…" and poll the `topups` row.** Do **not** gate the poll on the result type: a *successful* payment can still resolve as `dismiss` when the bounce page's custom-scheme redirect is gesture-blocked and the provider closes the sheet manually (§5b) — treating `dismiss` as "cancelled" would show a paid top-up as failed. Poll the row (its own RLS-visible record) until `status = 'paid'` → show success + new balance; only conclude "not paid" after the poll **times out** still `pending` (credit is webhook-driven and may lag 1–2s). The `topups.status` in the DB — never the `openAuthSessionAsync` result type or the URL `status` param — is the source of truth for whether the top-up succeeded. (The Earnings screen already subscribes to `transactions` realtime, so its history updates on its own.)
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
6. **Net-vs-base reconciliation:** after a real test top-up, confirm `topups.net_amount` was persisted and that `net_amount >= base_amount` (i.e. the configured effective rate covers PayMongo's real cut). A `net < base` case must surface the `RAISE WARNING` — check the function logs.
7. `tsc --noEmit` at 0 (regenerate `lib/database.types.ts` after the migration so `topups` + the new settings columns are typed).

---

## 9. Implementation order (investigate-first)

1. **Investigate** before writing anything — mostly done (§2c). Remaining:
   - ✅ `088` free; schema/enum/`is_approved` confirmed; method ids, VAT semantics, field paths, `whsk_`, v1 pin confirmed; redirect resolved to the §5b bounce page.
   - ⬜ **Empirical fee rates** — run one test-mode payment per method (GCash/Maya @ ₱1,000; card @ ₱500 and ₱2,000), read `payments[0].attributes.{amount,fee,net_amount}`, and set `fee_rate_*` / `fee_fixed_card` from the realized VAT-inclusive `fee`.
   - ⬜ **`profiles` RLS read** (`pg_policies`) — decide whether the `anon` write grant is exploitable-now vs defense-in-depth. `088` revokes it either way (§3.4).
2. Migration `088` (settings columns incl. effective rates, `topups` with `net_amount`, `confirm_topup`, **§3.4 `anon` REVOKE**) — write the file; apply manually via SQL Editor; regenerate `database.types.ts`.
3. `create-topup-checkout` edge function (pre-generates the topup id; deployed `verify_jwt=false`).
4. `paymongo-webhook` edge function (signature-verify first; persists `net_amount`); register it in PayMongo; set both secrets; deploy `verify_jwt=false`.
5. `topup-return` bounce edge function (§5b; `verify_jwt=false`).
6. `topup.tsx` rewrite (method picker + Maya, presets/min, charge summary, checkout launch, confirming/poll state).
7. Verify per §8; then `/codex-review` before finishing the branch (per the workflow rule).
