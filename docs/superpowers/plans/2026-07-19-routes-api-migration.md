# Routes API Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single legacy Google Directions API call in `components/LiveMap.tsx` with the Google Routes API (`directions/v2:computeRoutes`), with traffic-aware ETAs, by extracting the network/parse/format logic into a new `lib/computeRoute.ts` module.

**Architecture:** A new pure module `lib/computeRoute.ts` owns all Google-specific request/response handling and exposes `computeRoute(origin, destination, apiKey): Promise<RouteInfo | null>` plus the `RouteInfo` type. `LiveMap.tsx` becomes a thin consumer: it calls `computeRoute` from its existing 30s polling effect, guards against stale resolutions with an invalidation-epoch ref (bumped only on teardown / coordinate change), and renders the returned text/coords exactly as today. No UI, JSX, or style changes.

**Tech Stack:** TypeScript (strict), React Native + Expo SDK 54, React 19, `fetch` (global in RN), existing `lib/decodePolyline.ts`.

**Reference spec:** `docs/superpowers/specs/2026-07-19-routes-api-migration-design.md` (approved; Codex-approved round 2).

## Global Constraints

- **No test runner exists in this repo** (see `.claude/rules/stack.md`). Do **not** add jest/vitest/MSW or any test infra — that is scope creep and a convention violation. "Green" for every task = `npx tsc --noEmit` passes. Full runtime confirmation is the manual smoke in the Verification section.
- **No `any`.** Use `unknown` + type guards for untrusted JSON. Strict null checks respected.
- **`lib/` files are `camelCase.ts`** with named `export` for functions (matches `lib/decodePolyline.ts`). Declared `type` aliases, never inline object types for the public signature.
- **No env-var / key changes.** `EXPO_PUBLIC_GOOGLE_MAPS_KEY` stays; it is read in `LiveMap.tsx:45` as `GMAPS_KEY` and passed into `computeRoute`.
- **No UI changes.** `route.durationText` / `route.distanceText` must render byte-for-byte as today ("Arriving in ~15 mins", "3.2 km away").
- **Manual Google Cloud prerequisite (not code, but blocks runtime):** the Routes API must be enabled on the project behind the key, and the key's API + application restrictions must permit direct `routes.googleapis.com` web-service calls. A restriction mismatch surfaces as a silent 403 during the smoke — see Verification.

---

## File Structure

- **Create** `lib/computeRoute.ts` — Routes API client + `RouteInfo` type + private `formatDuration` / `formatDistance`. One responsibility: turn two coordinates into route text + polyline coords, or `null`.
- **Modify** `components/LiveMap.tsx` — consume the module; delete the inline URL build/parse, the local `RouteInfo`/`Coord` types, and the `decodePolyline` import; add the stale-response guard.

---

### Task 1: Create `lib/computeRoute.ts`

**Files:**
- Create: `lib/computeRoute.ts`

**Interfaces:**
- Consumes: `decodePolyline(encoded: string): { latitude: number; longitude: number }[]` from `lib/decodePolyline.ts` (existing, unchanged).
- Produces (relied on by Task 2):
  - `export type RouteInfo = { distanceText: string; durationText: string; coords: { latitude: number; longitude: number }[] }`
  - `export async function computeRoute(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }, apiKey: string): Promise<RouteInfo | null>`

- [ ] **Step 1: Write the module**

Create `lib/computeRoute.ts` with exactly this content:

```ts
import { decodePolyline } from './decodePolyline';

// ─── Types ──────────────────────────────────────────────────────────────────

type Coord = { latitude: number; longitude: number };
type Point = { lat: number; lng: number };

export type RouteInfo = {
  distanceText: string;
  durationText: string;
  coords: Coord[];
};

// ─── Constants ──────────────────────────────────────────────────────────────

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK =
  'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';
const DURATION_RE = /^(\d+(?:\.\d+)?)s$/;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Computes a traffic-aware driving route between two points via the Google
 * Routes API (directions/v2:computeRoutes). Returns null on any failure —
 * non-OK response, missing route, malformed duration, or network error — so
 * the caller can keep its last good route. Never throws.
 */
export async function computeRoute(
  origin: Point,
  destination: Point,
  apiKey: string,
): Promise<RouteInfo | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: {
          location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        // Defensive only: affects Google's display fields, not the raw
        // distanceMeters/duration we format ourselves.
        units: 'METRIC',
      }),
    });
    if (!res.ok) return null;

    const json: unknown = await res.json();
    const route = firstRoute(json);
    if (!route) return null;

    const durationText = formatDuration(route.duration);
    if (durationText === null) return null;

    return {
      distanceText: formatDistance(route.distanceMeters),
      durationText,
      coords: decodePolyline(route.polyline.encodedPolyline),
    };
  } catch {
    return null;
  }
}

// ─── Parsing / formatting (private) ─────────────────────────────────────────

type ParsedRoute = {
  duration: unknown;
  distanceMeters: number;
  polyline: { encodedPolyline: string };
};

/** Narrows the untyped Routes response to the fields we requested. */
function firstRoute(json: unknown): ParsedRoute | null {
  if (typeof json !== 'object' || json === null) return null;
  const routes = (json as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;

  const first: unknown = routes[0];
  if (typeof first !== 'object' || first === null) return null;
  const route = first as {
    duration?: unknown;
    distanceMeters?: unknown;
    polyline?: { encodedPolyline?: unknown };
  };

  const encoded = route.polyline?.encodedPolyline;
  if (typeof encoded !== 'string') return null;

  // distanceMeters is requested in the field mask and drives the "X km away"
  // text; a missing/NaN/negative value must fail clean rather than render a
  // false "0 m".
  const meters = route.distanceMeters;
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return null;

  return {
    duration: route.duration,
    distanceMeters: meters,
    polyline: { encodedPolyline: encoded },
  };
}

/**
 * Formats a protobuf Duration string ("870s", "3.5s") as ETA text
 * ("15 mins", "1 hr 5 mins"). Returns null for a malformed value so the
 * caller fails clean instead of rendering NaN. parseInt is avoided — it
 * would silently truncate and mask a bad value.
 */
function formatDuration(duration: unknown): string | null {
  if (typeof duration !== 'string') return null;
  const match = DURATION_RE.exec(duration);
  if (!match) return null;

  const totalMinutes = Math.max(1, Math.round(parseFloat(match[1]) / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} ${totalMinutes === 1 ? 'min' : 'mins'}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourPart = `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
  if (minutes === 0) return hourPart;
  return `${hourPart} ${minutes} ${minutes === 1 ? 'min' : 'mins'}`;
}

/** Formats a distance in meters as "850 m" (< 1 km) or "3.2 km". */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
```

- [ ] **Step 2: Typecheck the new module**

Run: `npx tsc --noEmit`
Expected: PASS (exit 0, no errors). This is the gate — there is no unit-test runner in this repo, and adding one is out of scope (Global Constraints).

- [ ] **Step 3: Sanity-check the formatting logic by reading it back**

Confirm by inspection against these cases (no runner to execute them; verify the branches by eye):
- `formatDuration("870s")` → `870/60 = 14.5` → `round` = `15` → `"15 mins"` ✓
- `formatDuration("30s")` → `0.5` → `round` = `1` (via `Math.max(1, …)`) → `"1 min"` ✓
- `formatDuration("3720s")` → `62` min → `1 hr 2 mins` ✓
- `formatDuration("3600s")` → `60` min → `hours=1, minutes=0` → `"1 hr"` ✓
- `formatDuration("banana")` → no regex match → `null` ✓
- `formatDistance(3200)` → `"3.2 km"`; `formatDistance(850)` → `"850 m"` ✓

- [ ] **Step 4: Commit**

```bash
git add lib/computeRoute.ts
git commit -m "$(cat <<'EOF'
feat(map): add Routes API client module

- Add lib/computeRoute.ts wrapping directions/v2:computeRoutes with a
  traffic-aware DRIVE request and the required X-Goog field mask, so the
  legacy Directions API call in LiveMap can be retired
- Return null on any failure (non-OK, missing route, malformed duration,
  network error) so the caller keeps its last good route; never throw
- Format the protobuf duration and raw meters ourselves since the Routes
  API drops the pre-formatted text the legacy endpoint provided
EOF
)"
```

---

### Task 2: Wire `components/LiveMap.tsx` to the module

**Files:**
- Modify: `components/LiveMap.tsx`

**Interfaces:**
- Consumes: `computeRoute` and `RouteInfo` from `lib/computeRoute` (Task 1).
- Produces: none (leaf consumer).

- [ ] **Step 1: Swap the import**

In `components/LiveMap.tsx`, replace the decodePolyline import (line 6):

```ts
import { decodePolyline } from '../lib/decodePolyline';
```

with:

```ts
import { computeRoute, RouteInfo } from '../lib/computeRoute';
```

- [ ] **Step 2: Delete the local `Coord` and `RouteInfo` types**

Remove lines 13–19 (the `Coord` type and the local `RouteInfo` type — both now come from the module). Keep the `LatLng` type on line 12. After the edit, that block reads only:

```ts
type LatLng = { lat: number; lng: number };
```

- [ ] **Step 3: Add the invalidation-epoch ref**

Immediately after the existing `routeTimerRef` declaration (currently line 86):

```ts
const routeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

add:

```ts
// Invalidation epoch: bumped by clearRouteTimer on teardown or coordinate
// change. A request captures the epoch when it starts and only setRoute if it
// still matches — so a request for stale coordinates (or one resolving after
// unmount) is dropped. A normal poll tick for the SAME coordinates does NOT
// bump the epoch, so a slow-but-still-valid response is never discarded
// (both results are valid; last write wins).
const routeEpochRef = useRef(0);
```

- [ ] **Step 4: Rewrite `clearRouteTimer` to invalidate in-flight requests**

Replace the existing `clearRouteTimer` (currently lines 169–174):

```ts
function clearRouteTimer() {
  if (routeTimerRef.current) {
    clearInterval(routeTimerRef.current);
    routeTimerRef.current = null;
  }
}
```

with:

```ts
function clearRouteTimer() {
  // Bump the epoch so any in-flight request resolving after teardown
  // (effect cleanup on unmount or coordinate change) is ignored. This is the
  // ONLY place the epoch advances — poll ticks do not touch it.
  routeEpochRef.current += 1;
  if (routeTimerRef.current) {
    clearInterval(routeTimerRef.current);
    routeTimerRef.current = null;
  }
}
```

- [ ] **Step 5: Rewrite `fetchRoute` to call the module**

Replace the entire existing `fetchRoute` (currently lines 176–198, the inline URL build + fetch + parse):

```ts
async function fetchRoute(origin: LatLng, destination: LatLng) {
  if (!GMAPS_KEY) return;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin.lat},${origin.lng}` +
      `&destination=${destination.lat},${destination.lng}` +
      `&mode=driving` +
      `&key=${GMAPS_KEY}`;
    const res  = await fetch(url);
    const json = await res.json();
    if (json.status !== 'OK' || !json.routes?.length) return;

    const leg = json.routes[0].legs[0];
    setRoute({
      distanceText: leg.distance.text,
      durationText: leg.duration.text,
      coords: decodePolyline(json.routes[0].overview_polyline.points),
    });
  } catch {
    // keep existing route on network error
  }
}
```

with:

```ts
async function fetchRoute(origin: LatLng, destination: LatLng) {
  if (!GMAPS_KEY) return;
  const epoch = routeEpochRef.current;
  const info = await computeRoute(origin, destination, GMAPS_KEY);
  // Drop the result only if the epoch advanced while awaiting — i.e. the
  // coordinates changed or the effect tore down (clearRouteTimer). A
  // concurrent poll for the SAME coordinates does not bump the epoch, so a
  // slow-but-still-valid response is never discarded. computeRoute returns
  // null on any failure, so "keep last route" holds by only setting on a
  // non-null result.
  if (info && epoch === routeEpochRef.current) setRoute(info);
}
```

- [ ] **Step 6: Typecheck the whole app**

Run: `npx tsc --noEmit`
Expected: PASS (exit 0). In particular confirm there are **no** "unused" or "cannot find name" errors for `decodePolyline`, `Coord`, or `RouteInfo` — the import swap and type deletions must be consistent. If `tsc` reports `decodePolyline` is undefined anywhere in the file, an inline usage was missed in Step 5.

- [ ] **Step 7: Grep for leftover legacy references**

Run: `grep -n "maps.googleapis.com\|overview_polyline\|decodePolyline\|type RouteInfo\|type Coord" components/LiveMap.tsx`
Expected: **no output.** Any hit means a legacy fragment survived the rewrite — fix it before committing.

- [ ] **Step 8: Commit**

```bash
git add components/LiveMap.tsx
git commit -m "$(cat <<'EOF'
feat(map): use Routes API for live route + ETA

- Point LiveMap at the new lib/computeRoute module and delete the inline
  legacy Directions API call, its local RouteInfo/Coord types, and the
  now-unused decodePolyline import
- Guard the polling effect with an invalidation-epoch ref (bumped only on
  teardown / coordinate change) so a stale in-flight route can't overwrite
  fresher data or setState after unmount — a latent race in the previous
  inline version — without discarding a valid same-coordinate poll result
- ETAs are now traffic-aware; render output ("~15 mins", "3.2 km away") is
  unchanged
EOF
)"
```

---

## Verification (post-implementation, manual)

1. **Typecheck:** `npx tsc --noEmit` is clean (the standing gate; run after both tasks).
2. **Build/boot:** `npx expo start` boots without a Metro/TypeScript error on the changed files.
3. **Google Cloud prerequisite (blocks the runtime smoke, not the build):** confirm the **Routes API** is enabled on the project behind `EXPO_PUBLIC_GOOGLE_MAPS_KEY`, and that the key's API + application restrictions permit direct `routes.googleapis.com` calls (the same key drives the native Maps SDK — an app-restricted key can 403 on web-service calls).
4. **Runtime smoke (needs a live order):** with the rider on `(provider)/active` and the customer on the order-tracking screen, both locations present:
   - The green route polyline draws between rider and customer.
   - The ETA pill shows "Arriving in ~N mins" and the drawer shows "X.X km away".
   - This doubles as the key-restriction check: if both locations are present but the route/ETA stay blank, inspect the network response for a **403** (restriction mismatch) before assuming a code bug.

## Post-plan handoff

Per `.claude/rules/workflow.md`: after both tasks are green, run `/codex-review` on the implementation, then `create-pr`. Merging stays the user's call (`/merge-pr`).
