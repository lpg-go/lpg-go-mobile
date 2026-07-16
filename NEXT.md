# What's Open

Snapshot as of 2026-07-16. Everything below is unstarted unless noted.

---

## 1. `lib/orderStatus.ts` — extract the order-status vocabulary

**Highest correctness payoff of anything here.** The status vocabulary is duplicated across five files and has already drifted:

- `pending` renders as **"Select Provider"** to customers and **"Waiting..."** to providers
- `awaiting_confirmation` renders as **"Awaiting Confirmation"** vs **"Awaiting"**

Sites:

| File | What it holds |
| --- | --- |
| `app/(customer)/order/[id].tsx:88-105` | `STATUS_CONFIG`, uses theme tokens |
| `app/(customer)/orders.tsx:28-35` | `STATUS_CONFIG`, **hardcodes `#16A34A` / `#F0FDF4` / `#DC2626`** |
| `app/(provider)/active/[id].tsx:74-81` | `STATUS_LABEL` |
| `app/(provider)/index.tsx:53-56` | `ACTIVE_STATUS_LABEL` |

The `OrderStatus` union is *also* re-declared in five places: `app/(customer)/orders.tsx:20`, `app/(customer)/order/[id].tsx:26`, `app/(provider)/active/[id].tsx:37`, `components/order/OrderTracking.tsx:26`, `components/order/OrderStatusTimeline.tsx:9`. The literals additionally appear inline in `find-store/[productId].tsx`, `(provider)/index.tsx`, and `lib/useActiveOrderCount.ts`.

**Why it matters:** adding a status means editing eight files with no compiler help, and the `orders.tsx` hardcoded hex violates the "never hardcode a color" rule in `.claude/rules/stack.md`.

**Proposed shape:** `lib/orderStatus.ts` exporting `export type OrderStatus = ...` plus `STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bg: string }>` using theme tokens only. Where provider wording must genuinely differ, make it an explicit second map (`PROVIDER_STATUS_LABEL`) **in the same file**, so the divergence is visible in one place instead of being an accident. Import the type everywhere rather than re-declaring it — that alone removes ~50 lines and makes exhaustiveness checks real.

Note: `lib/database.types.ts` is now generated, so the enum may be derivable from `Database['public']['Enums']` rather than hand-written. Check before writing a union by hand.

---

## 2. `app/(auth)/complete-profile.tsx` — BLOCKED on a product decision

**Blocked: where does `phone` come from for this flow?**

This screen is genuinely broken, not just untyped. It carries the **only remaining `tsc` error** (`complete-profile.tsx:71`), left standing deliberately — typing the payload would make a broken screen compile cleanly, which is worse than the error.

Three independent defects on one path:

1. **`phone` is omitted from the upsert** but is `not null unique` on `profiles`. `app/_layout.tsx:96` routes here **only when the profiles row is absent** (`if (!profile)`), so the upsert is always an INSERT — exactly the path where the NOT NULL violation fires.
2. **`provider_type` is written**, but migration `20240101000057_lock_profiles_columns.sql` does **not** grant UPDATE on that column (grants cover `full_name, phone, business_name, avatar_url, document_url, is_online, updated_at, rejected_at, rejection_reason, expo_push_token`). The ON CONFLICT DO UPDATE path would be rejected.
3. **`role` is collected and validated but never written**, despite `role` driving all downstream routing.

**Reachability:** narrow. `handle_new_user` normally creates the profiles row at signup, so `!profile` only occurs if that trigger failed or the row was deleted. But when it does occur, the recovery screen doesn't recover.

**Needs before it can be fixed:** a decision on where `phone` comes from here, and possibly a migration granting UPDATE on `provider_type`.

---

## 3. Six `any`s

`.claude/rules/stack.md` forbids `any`.

- `app/(provider)/index.tsx:146,147,150,153` — realtime payloads. Fix: `payload.new as { id: string; status: string; selected_provider_id: string | null }`. Now that the client is typed, the generated `Database` types may give a better shape than a hand-written cast — check first.
- `app/(provider)/products.tsx:106,107` — type the row and use a type guard in the `.filter()`.

---

## 4. DRY cleanup

Ordered by payoff. Findings 1, 7 and 8 from the review all land in a single new `lib/format.ts`, so they're best done as one change.

- **`components/ui/HeaderDark.tsx` — delete it.** 153 lines, **zero importers** (the only reference in the repo is its own `export default` on line 27). It's a dead parallel implementation of `IdentityHeader`, which is the live one used by both home screens. It carries its own third copy of the greeting helper. It reads like a shared primitive sitting in `components/ui/`, so the next person may extend the wrong one. Pure `rm`, highest payoff-per-effort here.
- **`lib/format.ts`** absorbing:
  - `getInitials` — **6 standalone definitions plus inline copies, with 4 different semantics.** `components/ui/Avatar.tsx:17` is the canonical one (first + last word, `'?'` fallback). They visibly disagree: "John Michael Smith" renders `JS` inside `Avatar` but `JM` elsewhere. `components/HeaderAvatar.tsx:54` computes `initials` and never uses it — dead, along with its `avatar`/`fallback`/`initials` styles at `:79-96`. Export one `getInitials(name?: string): string`, have `Avatar` import it, delete the rest.
  - `peso` — redefined per file and **twice inside one file** (`app/(provider)/earnings.tsx:160` and `:288-290`, identical bodies); inline three times in `topup.tsx:145,161,218`.
  - `timeAgo` — two implementations producing different strings: `(provider)/index.tsx:62-70` gives `'5m ago'`, `NotificationsScreen.tsx:150-162` gives `'5 minutes ago'`. Only the long form handles months, so the short form renders `'400d ago'`. Users see both formats in one app. Proposed: `timeAgo(iso, style: 'short' | 'long' = 'long')` — one date-math core, two label tables.
  - `formatPhone` **name collision** — `lib/auth.ts:4-7` is E.164 (`+63XXXXXXXXXX`, for the auth boundary); `(customer)/profile.tsx:50` and `(provider)/profile.tsx:64` are display (`+63 917 123 4567`). Two different functions, one name, one already exported from `lib/`. An autocomplete-driven wrong import produces a plausible but wrong value. Rename the display variant `formatPhoneForDisplay`; leave `lib/auth.ts:formatPhone` alone.
- **`lib/useAvatarUpload.ts`** — `handlePickAvatar` is **byte-for-byte identical** (42 lines) across `(customer)/profile.tsx:91-132` and `(provider)/profile.tsx:148-189`: permission prompt, picker options, `avatars/${user.id}/profile.jpg` path, `decode(base64)` upload, `?t=` cache-buster, profiles update, error handling. The storage path and cache-buster convention living in two copies is the real risk — change one and avatars silently break for the other role. `confirmSignOut` (10 lines) is also identical → `lib/auth.ts`.
- **`components/order/HistoryOrderCard.tsx`** — ~22 lines of JSX + ~14 style rules duplicated between `(customer)/history.tsx:167-214` and `(provider)/recent-orders.tsx:133-176`. The comments in both files literally say they mirror each other.
- **`components/ChatRoute.tsx`** — the two `chat/[orderId].tsx` routes are ~60 of 66 lines identical; only the selected column (`selected_provider_id` vs `customer_id`), the fallback label, and the `role` prop differ. Both also hardcode `#16A34A` instead of `colors.primary`. The two `notifications.tsx` routes already use exactly this shape with `NotificationsScreen` — a proven pattern in this repo.

**Deliberately NOT worth doing** (considered and rejected during review): a `useCurrentUser` hook wrapping the 24 `supabase.auth.getUser()` calls, or a generic wrapper over the ~12 `supabase.channel(...)` subscriptions. Usage genuinely differs per site, and `stack.md` pins fetch-in-`useEffect` as *the* pattern. `Card`/`StatCard`/`PartyCard` and `DetailHeader`/`SheetHeader`/`IdentityHeader` are correctly layered distinct concepts, not duplication.

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

## Done this session (for context)

Twelve commits, `0512fec..b2b5489`, all on `main`.

- **Price TOCTOU closed** — provider's quote frozen into `order_acceptances.quoted_prices`/`quoted_total` at accept time; both bidding surfaces display it. Codex-reviewed, APPROVE on round 2.
- **Phase C shipped** — 044 patched (it would have re-added a vulnerable 2-arg `select_provider_for_order` overload and stripped 068's `search_path` hardening), then 044 → 047 → 085 applied and verified on dev.
- **TDZ render crash** — `history.tsx` / `orders.tsx` white-screened on mount.
- **Admin redirect** — routed to a `(admin)` route group that doesn't exist.
- **Realtime leaks** — 3 subscriptions leaked on fast unmount; `notificationsStore` had its own variant; `active/[id].tsx` used `unsubscribe()` instead of `removeChannel()`.
- **Provider-home safety-net poll** — never armed for an already-offline provider.
- **Typecheck 49 → 1** — 33 were Deno edge functions wrongly checked by the Expo config; `lib/database.types.ts` generated and the client typed, which exposed three real bugs (a missing `lng` null-check before `place_order`, an unguarded `providerId` on the confirm-modal path, an unvalidated `provider_type` param).
