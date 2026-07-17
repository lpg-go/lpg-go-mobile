# LPG Go Mobile

@.claude/rules/workflow.md
@.claude/rules/security-hygiene.md
@.claude/rules/stack.md

> The `.claude/` directory (rules, skills, agents) is gitignored and local-only, so the three imports above load on a machine that has the toolkit and harmlessly resolve to nothing on a bare clone. Everything a new contributor needs to understand this app is documented inline below.

## Stack

- React Native + Expo SDK 54, React 19
- Expo Router ~6 (file-based routing)
- TypeScript (strict)
- Supabase — Postgres + Auth + Realtime + Storage
- Styling: `StyleSheet.create()` + design tokens from `lib/theme.ts` — never NativeWind/Tailwind classes
- Primary color: `#16A34A` (green)

## Project structure

- `app/(auth)/` — login, register, verify, verify-otp, forgot-password, reset-password, upload-document
- `app/(customer)/` — customer screens (index, orders, order/, brand/, find-store/, chat, history, notifications, profile)
- `app/(provider)/` — provider screens (index, active/, products, earnings, topup, recent-orders, reviews, chat, notifications, profile)
- `app/_layout.tsx` — root auth gate: holds the Supabase session, subscribes to `onAuthStateChange`, reads `profiles.role`, and redirects into the role group
- `lib/supabase.ts` — Supabase client (single instance, AsyncStorage-backed session)
- `lib/auth.ts` — phone-as-email helper (`formatPhoneAsEmail`)
- `lib/theme.ts` — design tokens (colors, spacing, radii, typography)
- `lib/orderStatus.ts` — single source for the order-status vocabulary
- `lib/notificationsStore.tsx` — cross-cutting notifications context
- `supabase/migrations/` — all SQL migrations (sequential timestamped names)

## Test accounts (dev)

- Customer: `09000000001`
- Dealer: `09000000002`
- Rider: `09000000003`

Passwords are shared dev credentials kept in the team password manager — not committed here (see `.claude/rules/security-hygiene.md`). Login uses phone-as-email: type the `9…` digits into the `+63` field (the leading `0` is dropped).

## Supabase

- Project ref: `rgqwaiassatyruptsgbs`
- Project URL: `https://rgqwaiassatyruptsgbs.supabase.co`
- Env vars: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (in `.env.local`, gitignored)
- Storage bucket: `images` (public) — `brands/{id}/`, `products/{id}/`, `avatars/`, `documents/{userId}/`
- **Migrations are applied MANUALLY via the Supabase SQL Editor — never `supabase db push`.** Ship schema changes as new numbered migrations in `supabase/migrations/`; never edit an already-applied migration.

## Key patterns

- Phone auth uses phone-as-email: `639XXXXXXXXX@lpggo.app` (13-digit `+639XXXXXXXXX` is the canonical `profiles.phone`, enforced by a CHECK constraint)
- Money and order-lifecycle writes go through `SECURITY DEFINER` RPCs (`place_order`, `accept_order`, `select_provider_for_order`, `confirm_delivery`, `mark_delivered`, `cancel_order`, etc.) — direct client writes to those columns are revoked at the grant level. RLS is the real enforcement boundary; client-side role checks are UX only.
- Server state lives in component `useState`/`useEffect` (fetch on mount, patch on realtime events); realtime via `supabase.channel(...)`. No query library.
- Use `npx expo install` for Expo packages; use `--legacy-peer-deps` if `npm install` fails on peer deps.

## Realtime tables enabled

`orders`, `order_acceptances`, `messages`, `provider_products`, `provider_locations`, `brands`

## Order flow

`pending → awaiting_dealer_selection → in_transit → awaiting_confirmation → delivered` (or `cancelled` at any point)
