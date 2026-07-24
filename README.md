# LPG Go — Mobile

React Native / Expo app for ordering and delivering LPG (cooking gas) cylinders. One app serves three roles, gated at sign-in:

- **Customer** — browse brands, place an order, track the rider live on a map, chat, and confirm delivery.
- **Dealer** — manage products and pricing, accept incoming orders, and view earnings.
- **Rider** — take active deliveries, share live location, and update order status through to delivered.

The backend is [Supabase](https://supabase.com) (Postgres + Auth + Realtime + Storage). Money and order-lifecycle writes go through `SECURITY DEFINER` RPCs, and Row-Level Security is the real enforcement boundary — client-side role checks are UX only.

## Tech stack

- **Expo** SDK 54 · **React Native** 0.81 · **React** 19
- **Expo Router** ~6 — file-based routing, route groups by role
- **TypeScript** (strict)
- **Supabase** — `@supabase/supabase-js` v2 (Postgres, Auth, Realtime, Storage)
- **Maps** — `react-native-maps` + Google Maps / Routes API for live routing and ETAs
- **Styling** — `StyleSheet.create()` + design tokens from `lib/theme.ts` (primary green `#16A34A`)

Server state lives in component `useState`/`useEffect`, patched from `supabase.channel(...)` realtime events — there is no query library.

## Prerequisites

- **Node** 20+ (developed on 20.20.x) and npm
- **Expo CLI** via `npx expo` (no global install needed)
- A **Supabase** project (URL + anon key) — the schema lives in `supabase/migrations/`
- A **Google Maps API key** with the Maps SDK and Routes API enabled
- To run on a device/emulator: iOS Simulator (Xcode), an Android emulator, or the **Expo Go** app on a physical phone

## Getting started

```bash
# 1. Clone and install
git clone <repo-url>
cd lpg-go-mobile
npm install          # if peer-deps fail: npm install --legacy-peer-deps

# 2. Create your environment file (see next section)
cp .env.example .env.local   # then fill in real values

# 3. Start the dev server
npm run start        # Expo dev server + QR code
npm run ios          # open in iOS Simulator
npm run android      # open in Android emulator
npm run web          # open in a browser
```

Scan the QR code with Expo Go, or press `i` / `a` in the terminal to launch a simulator.

## Environment variables

Create `.env.local` in the project root. It is **gitignored** — get the real values from the team password manager, never commit them. All keys are `EXPO_PUBLIC_*` so they are readable by the client bundle.

| Variable | Description |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL, e.g. `https://<ref>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (publishable) key |
| `EXPO_PUBLIC_APP_SECRET` | App-level shared secret used by client helpers |
| `EXPO_PUBLIC_GOOGLE_MAPS_KEY` | Google Maps / Routes API key (also wired into iOS & Android native config) |

Example `.env.local`:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=REPLACE_ME
EXPO_PUBLIC_APP_SECRET=REPLACE_ME
EXPO_PUBLIC_GOOGLE_MAPS_KEY=REPLACE_ME
```

## Database & migrations

All schema lives in `supabase/migrations/` as sequential, timestamped SQL files.

- **Migrations are applied MANUALLY via the Supabase SQL Editor** — do **not** run `supabase db push`.
- Ship every schema change as a **new** numbered migration. **Never edit an already-applied migration.**
- Storage uses a public `images` bucket (`brands/`, `products/`, `avatars/`, `documents/`).

## Test accounts (dev)

Login uses **phone-as-email**: type only the `9…` digits into the `+63` field (the leading `0` is dropped). The canonical `profiles.phone` is `+639XXXXXXXXX`, mapped to `639XXXXXXXXX@lpggo.app` internally.

| Role | Phone |
| --- | --- |
| Customer | `09000000001` |
| Dealer | `09000000002` |
| Rider | `09000000003` |

Passwords are shared dev credentials kept in the team password manager — not committed here.

## Project structure

```
app/                    # Expo Router routes, grouped by role
  _layout.tsx           # root auth gate: holds session, reads role, redirects
  (auth)/               # login, register, verify, OTP, password reset, upload-document
  (customer)/           # browse brands, orders, live tracking, chat, history, profile
  (provider)/           # products, active deliveries, earnings, top-up, reviews, chat
lib/
  supabase.ts           # single Supabase client (AsyncStorage-backed session)
  auth.ts               # phone-as-email helpers
  theme.ts              # design tokens (colors, spacing, radii, typography)
  orderStatus.ts        # single source for the order-status vocabulary
  notificationsStore.tsx# cross-cutting notifications context
  computeRoute.ts       # Google Routes API integration
supabase/
  migrations/           # timestamped SQL migrations (applied manually)
  functions/            # edge functions
  seed.sql              # local seed data
assets/                 # images, fonts, icons
```

## Order flow

```
pending → awaiting_dealer_selection → in_transit → awaiting_confirmation → delivered
```

An order can move to `cancelled` at any point. The vocabulary is defined once in `lib/orderStatus.ts`.

## Further reading

- **`CLAUDE.md`** — the source of truth for architecture, conventions, and key patterns (read this before contributing).
- **`NEXT.md`** — current roadmap and in-flight work.
- **`docs/`** — design specs and implementation plans for shipped features.
