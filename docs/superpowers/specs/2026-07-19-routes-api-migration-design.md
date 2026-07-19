# Migrate LiveMap routing to the Google Routes API

**Date:** 2026-07-19
**Status:** Approved — ready for implementation plan
**Scope:** Replace the single legacy Google Directions API call in `components/LiveMap.tsx` with the newer Routes API (`computeRoutes`).

## Motivation

Google marked the classic Directions API as legacy in 2025. `components/LiveMap.tsx` calls it directly to draw the rider→customer route line and populate the ETA pill and "distance away" text. Migrating to the Routes API keeps the feature on a supported endpoint and lets us opt into live-traffic-adjusted ETAs, which are more accurate for a delivery app.

## Prerequisite (manual, Google Cloud Console — not code)

- The **Routes API** must be enabled on the GCP project backing `EXPO_PUBLIC_GOOGLE_MAPS_KEY`.
- The API key must be permitted to call the Routes API (API restrictions).
- No key value or env var name changes.

Until this is done, requests return 403 and the route/ETA silently won't render. The code fails safe: on any failure it keeps the last successfully fetched route (unchanged from today's behavior).

## Endpoint shape change

| | Legacy Directions API | Routes API |
|---|---|---|
| Method / URL | `GET maps.googleapis.com/maps/api/directions/json` | `POST routes.googleapis.com/directions/v2:computeRoutes` |
| Auth | `&key=` in query string | `X-Goog-Api-Key` header (out of the URL) |
| Field selection | n/a | `X-Goog-FieldMask` header (required) |
| Distance | `routes[0].legs[0].distance.text` (pre-formatted, e.g. "3.2 km") | `routes[0].distanceMeters` (number) |
| Duration | `routes[0].legs[0].duration.text` (pre-formatted, e.g. "15 mins") | `routes[0].duration` (string, e.g. `"870s"`) |
| Polyline | `routes[0].overview_polyline.points` (encoded) | `routes[0].polyline.encodedPolyline` (encoded) |

Because the Routes API returns raw numbers/strings instead of pre-formatted text, we now format distance and duration ourselves to match today's display.

## Design

### New module: `lib/computeRoute.ts`

Mirrors the existing `lib/decodePolyline.ts` style (small, focused, camelCase verb name). Owns all Google-specific request/response handling so `LiveMap` stays a view.

- `export type RouteInfo = { distanceText: string; durationText: string; coords: Coord[] }` — moves here from `LiveMap`.
- `export async function computeRoute(origin, destination, apiKey): Promise<RouteInfo | null>`
  - `origin` / `destination`: `{ lat: number; lng: number }`.
  - POST body:
    - `origin` / `destination` → `{ location: { latLng: { latitude, longitude } } }`
    - `travelMode: "DRIVE"`
    - `routingPreference: "TRAFFIC_AWARE"` (balanced tier — not the pricier `TRAFFIC_AWARE_OPTIMAL`)
    - `units: "METRIC"`
  - Headers: `Content-Type: application/json`, `X-Goog-Api-Key: apiKey`, `X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline`
  - Returns `null` on non-OK response, missing `routes`, or a thrown error. Never throws to the caller.
  - Decodes `routes[0].polyline.encodedPolyline` via the existing `decodePolyline`.
- Private formatters (replace the text the legacy API used to hand us):
  - `formatDuration(seconds)` → `"15 mins"`. Round to nearest minute, floor of "1 min"; over an hour → `"1 hr 5 mins"`. Duration string is parsed with `parseInt("870s", 10)`.
  - `formatDistance(meters)` → `"3.2 km"`; under 1 km → `"850 m"`.

### Edit: `components/LiveMap.tsx`

- `fetchRoute` collapses to:
  ```ts
  const info = await computeRoute(origin, destination, GMAPS_KEY);
  if (info) setRoute(info);
  ```
  Preserves: the `if (!GMAPS_KEY) return` guard, the 30s polling interval, and "keep last route on failure" (only `setRoute` when non-null).
- Remove the local `RouteInfo` type declaration and the now-unused `decodePolyline` import (both live in the module now); import `RouteInfo` and `computeRoute` from `lib/computeRoute`.
- No JSX, style, or UI changes. `route.durationText` / `route.distanceText` render exactly as today ("Arriving in ~15 mins", "3.2 km away").

## Behavior delta

- ETAs become live-traffic-adjusted (intended improvement).
- Distance/duration formatting is now ours; it matches the current look.
- Polyline drawing, markers, ETA pill, and the bottom drawer are untouched.
- Cost: `TRAFFIC_AWARE` bills at the Routes "Advanced" SKU; polling stays at one call / 30s while both locations are present.

## Verification

- No test runner exists in this repo (see `stack.md`). "Green" = `tsc --noEmit` passes + the Expo build succeeds.
- Runtime smoke requires a live order with both rider and customer locations present (rider on `(provider)/active`, customer on the order tracking screen); it can't be driven headlessly. Flagged as a manual check.

## Out of scope

- Rotating or restricting the API key value.
- Upgrading `react-native-maps`.
- Any other Directions/Places usage (there is none — this is the only call site).
