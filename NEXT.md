# What's Open

Snapshot as of 2026-07-19. **The PayMongo provider top-up shipped to `main` (PRs #4, #5) and is live + verified on `lpg-go-dev`; `tsc` is at 0.** **Two tracks remain open:** (1) **Mobile app QA** — the Phase C flows (`quoted_total` render, provider accept, missing-profile signout) have been verified only by typecheck and code-tracing; nobody has watched them run in the app. Real verification gap, closed by exercising the flows via `expo start`. (Note: the top-up flow itself *was* exercised end-to-end on dev.) (2) The **pre-launch prod check** below — now also covers the top-up's **dev-only** DB + edge functions.

---

## PRE-LAUNCH — inspect `lpg-go-prod` before unpausing

**Every schema fact established on 2026-07-16 describes `lpg-go-dev` only. Do not assume prod matches dev.**

- Two projects exist: `lpg-go-dev` (`rgqwaiassatyruptsgbs`, **the linked one**, where beta runs) and `lpg-go-prod` (`glurbbiyxlgnartwjbsz`, **paused, never inspected**).
- Migrations here are applied **manually and out of numeric order**. The ledger (`supabase_migrations.schema_migrations`) records only `000`–`029` and reports `030`–`085` as unapplied — yet `pg_proc` proves 061/068/083 are live on dev. **The ledger is stale and must not be trusted as evidence of applied state.**
- **Never run `supabase db push`.** It would trust that stale ledger and replay ~50 already-applied migrations in numeric order — including running 044 before 083, re-running `DROP COLUMN stock`, and re-adding constraints. It would wreck the database.
- At least one change exists **only in the database**: the 6-arg `place_order` overload was dropped by hand, and no migration contains that `drop`. So prod could differ from dev in ways no file records.

**Before unpausing prod, introspect its real schema** — `pg_proc` (signatures + `proconfig`), `pg_constraint`, `information_schema.columns` — and compare against dev. Migration files record *intent*, not state.

**How this bit us on 2026-07-16:** three separate confident, file-derived findings were each disproved by a single query — a stale `place_order` overload that didn't exist, a constraint breakage that was never applied, and a plaintext-password "leak" (migration 083) on seeded accounts that **do not exist on dev at all** (verified by email and by seed UUID, zero rows both ways). Don't re-raise that password finding for dev without first confirming the rows exist.

### Top-up feature is DEV-ONLY — extra prod-launch steps

The PayMongo top-up (PRs #4/#5) is applied/deployed on **dev only**. After the schema introspection above establishes prod's real baseline, on `lpg-go-prod`:

- **Apply migrations manually** (prod SQL Editor, never `db push`): **088** (`topups` + `confirm_topup` credit RPC + settings columns/constraints + `anon` REVOKE) and **089** (`profiles` UPDATE policy → `authenticated`). Confirm prod actually has the objects 088 assumes (`platform_settings` single row, `transactions.reference_id`, `transaction_type` enum has `topup`, `profiles.is_approved`).
- **Deploy the 3 edge functions** to prod with `--no-verify-jwt`: `create-topup-checkout`, `paymongo-webhook`, `topup-return` (`config.toml` already pins `verify_jwt=false`).
- **PayMongo LIVE setup:** set prod secrets `PAYMONGO_SECRET_KEY=sk_live_…` + `PAYMONGO_WEBHOOK_SECRET=whsk_…`, and register the **live** webhook (event `checkout_session.payment.paid`). **No code change** — the webhook already verifies whichever of `te`/`li` is present.
- **⚠️ Hardcoded dev ref gotcha:** `app/(provider)/topup.tsx` has `FUNCTIONS_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1'` — the **dev** ref, literal (same pattern as the hardcoded OTP URLs in `register.tsx`/`verify-otp.tsx`). A prod build must repoint these to the prod ref, or the app calls dev functions.
- **Fee rates** are validated estimates: GCash 2.5% / Maya 2.0% confirmed on dev; card 3.5% domestic (test cards bill 4.5% international — the domestic rate can't be measured with test cards). Watch `confirm_topup` `net < base` warnings for foreign-card losses. Full detail in the `paymongo_topup_fee_rates` auto-memory.
- **Do NOT** add a top-up expiry sweep (see the 2026-07-19 Done block — rejected).

---

## Done — 2026-07-19: PayMongo provider top-up

Shipped to `main` (dev only — prod steps above). PRs **#4** (feature) and **#5** (policy tightening).

- **Feature (#4)** — provider Top-Up screen takes real PayMongo payments (GCash/Maya/card). Migration **088**: `topups` ledger (RLS read-own, `UNIQUE(checkout_session_id)`), `confirm_topup` `SECURITY DEFINER` credit RPC (credits server-stored `base` only, validates paid amount + status, idempotent under `FOR UPDATE`), settings columns + CHECK constraints, defensive `REVOKE … FROM anon` on `profiles`. Three edge functions: `create-topup-checkout` (auth + integer-centavo gross charge rounded up to a whole peso), `paymongo-webhook` (raw-body HMAC verify → credit), `topup-return` (https bounce to the app scheme). `topup.tsx` rewritten (Maya, per-method `allow_*_topup` gating decoupled from the customer `allow_card_payment`, poll on DB status as source of truth).
- **Reviews** — spec cleared 2 Claude + 2 Codex rounds; branch cleared a Codex review (**caught a Critical**: the webhook hardcoded the test `te` signature → every *live* payment would 401 and never credit — fixed to match `te` OR `li`) plus the 4-reviewer PR gate. Runtime-verified on dev: real GCash/Maya/card test payments credited exactly once, forged-signature webhook → 401, SQL idempotency harness.
- **Policy tightening (#5)** — migration **089**: `profiles` UPDATE RLS policy `{public}` → `{authenticated}` (byte-identical predicate). The `anon` REVOKE in 088 was defense-in-depth: RLS already blocked anon (`id = auth.uid()` unsatisfiable for anon), and the only real gap — the RLS-blind `TRUNCATE` grant — wasn't reachable via the anon PostgREST API.
- **Fee rates** — GCash 2.5% / Maya 2.0% confirmed against real dev payments; card kept 3.5% domestic. Foreign-card edge case (~1% loss, `net < base` warning logs it) accepted. See the `paymongo_topup_fee_rates` memory.

**Deliberately NOT done** (rejected — don't re-propose): a local `expire-stale-topups` cron to mark abandoned `pending` rows `expired`. Codex found PayMongo checkout sessions **never auto-expire**, so a local sweep could strand a genuine late payment (`confirm_topup` credits only `pending` rows → a paid webhook on an already-`expired` row returns `duplicate`, no credit). Pending rows are harmless; leave them. Proper version if ever needed: expire via PayMongo's Expire-Session API first, or make `confirm_topup` also credit `expired` rows.

---

## Done — the full 2026-07-16 review sweep

All on `main`. Every dry-checker / security-reviewer / api-checker / general-code-reviewer panel finding is addressed. `tsc` is at **0** (was 49).

- **`complete-profile.tsx` removed** (`3413c48`) — it was orphaned from the pre-C5 client-`signUp` flow: `register.tsx` + `verify-otp` now own signup entirely, and the columns it wrote (`role`, `provider_type`) were deliberately locked from client writes by C3 / migration 057, so it could never work. Its only entry (`!profile`) now signs out with an explanation (mirroring the admin branch), which is the real recovery since a client can't rebuild a locked profile — a re-register recreates it server-side.

**Security & correctness**
- **Price TOCTOU closed** — provider's quote frozen into `order_acceptances.quoted_prices`/`quoted_total` at accept time; BOTH bidding surfaces (`order/[id].tsx` and `find-store/[productId].tsx`) display it. Codex found the second surface that four in-house reviewers missed; APPROVE on round 2.
- **Phase C shipped** — 044 patched (it would have re-added a vulnerable 2-arg `select_provider_for_order` overload and stripped 068's `search_path` hardening), then 044 → 047 → 085 applied and verified on dev.
- **TDZ render crash** — `history.tsx` / `orders.tsx` white-screened on mount (dep-array TDZ).
- **Admin redirect** — routed to a `(admin)` route group that doesn't exist; now signs out.
- **Realtime leaks** — 3 subscriptions leaked on fast unmount; `notificationsStore` had its own variant; `active/[id].tsx` used `unsubscribe()` instead of `removeChannel()`.
- **Provider-home safety-net poll** — never armed for an already-offline provider.
- **iOS foreground notifications** — added `shouldShowBanner`/`shouldShowList`.

**Types**
- **Typecheck 49 → 1** — 33 were Deno edge functions wrongly checked by the Expo config (excluded); `lib/database.types.ts` generated and the client typed, which exposed three real bugs (missing `lng` null-check before `place_order`, unguarded `providerId` on the confirm-modal path, unvalidated `provider_type` param).
- **Six `any`s removed** — realtime handler typed via the `.on<orders['Row']>` generic; `products.tsx` embeds inferred cleanly (both FKs `not null`).

**DRY**
- `lib/orderStatus.ts` — status vocabulary single-sourced, type derived from the DB enum. (One intentional label fix: provider `awaiting_confirmation` was truncation drift.)
- `lib/format.ts` — `getInitials` / `peso` / `timeAgo` consolidated (the divergent copies were all dead); `formatPhone` name collision disambiguated to `formatPhoneForDisplay`.
- `lib/useAvatarUpload.ts` — the byte-identical 43-line avatar flow, single-sourcing the storage-path/cache-buster convention.
- Deleted `HeaderDark.tsx` (153 dead lines, zero importers).

**Deliberately NOT done** (considered, rejected — don't re-propose): a `useCurrentUser` hook over the 24 `getUser()` calls, or a generic wrapper over the ~12 `supabase.channel(...)` subscriptions — usage genuinely differs per site and `stack.md` pins fetch-in-`useEffect`. `ACTIVE_STATUSES` looks like a fifth status duplicate but the two definitions are different sets (`orders.tsx` includes `pending`, `useActiveOrderCount` excludes it) — sharing one would silently change the orders list or the nav badge count.
