# LPG Go Mobile

## Stack
- React Native + Expo SDK 54
- Expo Router v3 (file-based routing)
- Supabase (auth, database, realtime, storage)
- StyleSheet from react-native (no NativeWind)
- Primary color: #16A34A

## Project structure
- app/(auth)/ — login, register, upload-document, pending-approval
- app/(customer)/ — customer app screens
- app/(provider)/ — provider app screens
- lib/supabase.ts — Supabase client
- lib/auth.ts — phone-as-email helper
- lib/cartStore.ts — global cart context
- components/ — shared components 
- supabase/migrations/ — all SQL migrations

## Test accounts
- Customer One: 09000000001 / 000000
- Dealer One: 09000000002 / 111111
- Rider One: 09000000003 / 222222
- Customer Two: 09560623082 (existing, password unchanged)
- Dave: 09000000005 (existing, password unchanged)
- Admin: accounts@lpggodelivery.com / iT3chlpg.25

## Supabase
- Project ref: rgqwaiassatyruptsgbs
- Project URL: https://rgqwaiassatyruptsgbs.supabase.co
- Storage bucket: images (public)
  - brands/{id}/ — brand logos
  - products/{id}/ — product images
  - avatars photos
  - documents/{userId}/ — provider docs

## Key patterns
- Phone auth uses phone-as-email: 639XXXXXXXXX@lpggo.app
- profiles.phone is canonical +639XXXXXXXXX (13 chars), enforced by phone_format_check CHECK constraint
- Always use --legacy-peer-deps when npm install fails
- Use npx expo install for Expo packages
- Migrations go in supabase/migrations/ with sequential naming
- Push migrations with: supabase db push
- All styling uses StyleSheet.create() — never NativeWind/Tailwind classes

## Realtime tables enabled
orders, order_acceptances, messages, provider_products, provider_locations, brands

## Order flow
pending → awaiting_dealer_selection → in_transit → awaiting_confirmation → delivered
