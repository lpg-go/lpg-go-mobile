# What's Open

Snapshot as of 2026-07-17. **The review-panel backlog is cleared and `tsc` is at 0**, but **two items remain open**: (1) **Mobile app QA** — the Phase C flows (`quoted_total` render, provider accept, missing-profile signout) have been verified only by typecheck and code-tracing; nobody has watched them run in the app. This is a real verification gap, closed by exercising the flows via `expo start`. (2) The **pre-launch prod check** below.

---

## PRE-LAUNCH — inspect `lpg-go-prod` before unpausing

**Every schema fact established on 2026-07-16 describes `lpg-go-dev` only. Do not assume prod matches dev.**

- Two projects exist: `lpg-go-dev` (`rgqwaiassatyruptsgbs`, **the linked one**, where beta runs) and `lpg-go-prod` (`glurbbiyxlgnartwjbsz`, **paused, never inspected**).
- Migrations here are applied **manually and out of numeric order**. The ledger (`supabase_migrations.schema_migrations`) records only `000`–`029` and reports `030`–`085` as unapplied — yet `pg_proc` proves 061/068/083 are live on dev. **The ledger is stale and must not be trusted as evidence of applied state.**
- **Never run `supabase db push`.** It would trust that stale ledger and replay ~50 already-applied migrations in numeric order — including running 044 before 083, re-running `DROP COLUMN stock`, and re-adding constraints. It would wreck the database.
- At least one change exists **only in the database**: the 6-arg `place_order` overload was dropped by hand, and no migration contains that `drop`. So prod could differ from dev in ways no file records.

**Before unpausing prod, introspect its real schema** — `pg_proc` (signatures + `proconfig`), `pg_constraint`, `information_schema.columns` — and compare against dev. Migration files record *intent*, not state.

**How this bit us on 2026-07-16:** three separate confident, file-derived findings were each disproved by a single query — a stale `place_order` overload that didn't exist, a constraint breakage that was never applied, and a plaintext-password "leak" (migration 083) on seeded accounts that **do not exist on dev at all** (verified by email and by seed UUID, zero rows both ways). Don't re-raise that password finding for dev without first confirming the rows exist.

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
