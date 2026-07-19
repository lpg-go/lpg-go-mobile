# Migrate LiveMap routing to the Google Routes API

**Date:** 2026-07-19
**Status:** Approved — ready for implementation plan
**Scope:** Replace the single legacy Google Directions API call in `components/LiveMap.tsx` with the newer Routes API (`computeRoutes`).

## Motivation

Google marked the classic Directions API as legacy in 2025. `components/LiveMap.tsx` calls it directly to draw the rider→customer route line and populate the ETA pill and "distance away" text. Migrating to the Routes API keeps the feature on a supported endpoint and lets us opt into live-traffic-adjusted ETAs, which are more accurate for a delivery app.

## Prerequisite (manual, Google Cloud Console — not code)

- The **Routes API** must be enabled on the GCP project backing `EXPO_PUBLIC_GOOGLE_MAPS_KEY`.
- **API restrictions:** the key must be permitted to call the Routes API.
- **Application restrictions:** the same key currently drives the native Maps SDK (`app.config.js:11`, `app.config.js:15`). If the key carries an Android-app / iOS-app application restriction, direct client-side calls to `routes.googleapis.com` (a web-service API) can return **403 even when the Routes API is enabled** — application restrictions aren't honored the same way for web-service endpoints as for the Maps SDK. Confirm the key's application restriction still permits the Routes web-service call; if it doesn't and can't be loosened without weakening map security, that's a signal to split into a separate key — but that decision is out of scope here (locked: no env-var/key-name change), so this migration surfaces it as a prerequisite check, not a code change.
- No key value or env var name changes.

Until this is done, requests return 403 and the route/ETA silently won't render. The code fails safe: on any failure it keeps the last successfully fetched route (unchanged from today's behavior). Because the 403 is silent, the first-run manual smoke (see Verification) is where a restriction mismatch will surface — check it there.

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
    - `units: "METRIC"` — defensive only. It affects Google's *display* fields (localized text), **not** the raw `distanceMeters` / `duration` we consume, since we format those ourselves. Harmless to send; not load-bearing.
  - Headers: `Content-Type: application/json`, `X-Goog-Api-Key: apiKey`, `X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline`
  - Returns `null` on non-OK response, missing `routes`, or a thrown error. Never throws to the caller.
  - Decodes `routes[0].polyline.encodedPolyline` via the existing `decodePolyline`.
- Private formatters (replace the text the legacy API used to hand us):
  - `formatDuration(duration)` → `"15 mins"`. Round to nearest minute, floor of "1 min"; over an hour → `"1 hr 5 mins"`. The Routes `duration` is a protobuf Duration string that can carry a fractional part (e.g. `"870s"` or `"3.5s"`), so parse it as `parseFloat(duration)` after asserting the trailing `s` (regex `^(\d+(?:\.\d+)?)s$`); a value that doesn't match returns `null` from `computeRoute` (fail clean rather than render `NaN`). `parseInt` is avoided — it would silently truncate and mask a malformed value.
  - `formatDistance(meters)` → `"3.2 km"`; under 1 km → `"850 m"`.

### Edit: `components/LiveMap.tsx`

- `fetchRoute` collapses to an awaited `computeRoute` call, but **guards against stale resolutions**. The current code already has a latent race — a fetch started for one set of coordinates can resolve *after* the locations changed (polling every 30s) or after the component unmounted, and would then `setRoute` with stale data or warn on an unmounted setState. The rewrite closes it with a monotonic request sequence:
  ```ts
  const reqSeqRef = useRef(0);
  // inside fetchRoute:
  const seq = ++reqSeqRef.current;
  const info = await computeRoute(origin, destination, GMAPS_KEY);
  if (info && seq === reqSeqRef.current) setRoute(info);
  ```
  Any newer call (from a coordinate change or the next poll tick) bumps `reqSeqRef`, so a late-resolving older request is dropped. The polling `useEffect` cleanup increments the ref too, so an in-flight request that resolves after the effect tears down is ignored (covers unmount and dependency change).
  Preserves: the `if (!GMAPS_KEY) return` guard, the 30s polling interval, and "keep last route on failure" (only `setRoute` when non-null *and* current).
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
- The smoke doubles as the **key-restriction check** from the Prerequisite: if the route line and ETA render, the key is accepted for the Routes web-service call; if they stay blank while both locations are present, inspect the network response for a 403 (application/API restriction mismatch) before assuming a code bug.

## Out of scope

- Rotating or restricting the API key value.
- Upgrading `react-native-maps`.
- Any other Directions/Places usage (there is none — this is the only call site).
