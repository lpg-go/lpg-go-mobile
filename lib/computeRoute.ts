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
  if (typeof encoded !== 'string' || encoded.length === 0) return null;

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
