import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';

import { decodePolyline } from '../lib/decodePolyline';

// ─── Types ────────────────────────────────────────────────────────────────────

type LatLng = { lat: number; lng: number };
type Coord = { latitude: number; longitude: number };

type RouteInfo = {
  distanceText: string;
  durationText: string;
  coords: Coord[];
};

type Props = {
  providerLocation: LatLng | null;
  customerLocation: LatLng | null;
  /** Compass heading (degrees) from watchPositionAsync to rotate the truck icon */
  providerHeading?: number | null;
  /** Name shown in the bottom card (driver's name for customer view) */
  providerName?: string;
  businessName?: string;
  deliveryAddress?: string;
  onBack?: () => void;
  onChat?: () => void;
  onCall?: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = '#16A34A';
const DEFAULT_DELTA = 0.02;
const ROUTE_INTERVAL_MS = 30_000;
const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

const MAP_STYLE = [
  { featureType: 'all',           elementType: 'geometry',  stylers: [{ color: '#f5f5f5' }] },
  { featureType: 'road',          elementType: 'geometry',  stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'geometry',  stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway',  elementType: 'geometry',  stylers: [{ color: '#dadada' }] },
  { featureType: 'water',         elementType: 'geometry',  stylers: [{ color: '#c9e8f5' }] },
  { featureType: 'poi',           elementType: 'labels',    stylers: [{ visibility: 'off' }] },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function LiveMap({
  providerLocation,
  customerLocation,
  providerHeading,
  providerName,
  businessName,
  deliveryAddress,
  onBack,
  onChat,
  onCall,
}: Props) {
  const mapRef = useRef<MapView>(null);

  const initialLoc = providerLocation ?? customerLocation;
  const initialRegion: Region | undefined = initialLoc
    ? {
        latitude: initialLoc.lat,
        longitude: initialLoc.lng,
        latitudeDelta: DEFAULT_DELTA,
        longitudeDelta: DEFAULT_DELTA,
      }
    : undefined;
  const regionRef = useRef<Region | null>(initialRegion ?? null);

  const [route, setRoute] = useState<RouteInfo | null>(null);
  const routeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Customer pulse animation ──────────────────────────────────────────────

  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const pulseScale   = pulseAnim.interpolate({ inputRange: [0, 1],         outputRange: [1, 2.6]     });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 0.4, 1],    outputRange: [0.5, 0.2, 0] });

  // ── Map fit ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fitMap();
  }, [providerLocation, customerLocation]);

  function fitMap() {
    if (!mapRef.current) return;

    if (providerLocation) {
      mapRef.current.animateCamera(
        {
          center: { latitude: providerLocation.lat, longitude: providerLocation.lng },
          pitch: 60,
          heading: providerHeading ?? 0,
          zoom: 17,
          altitude: 500,
        },
        { duration: 600 }
      );
      return;
    }

    const single = customerLocation;
    if (single) {
      mapRef.current.animateCamera(
        {
          center: { latitude: single.lat, longitude: single.lng },
          pitch: 0,
          heading: 0,
          zoom: 15,
          altitude: 1000,
        },
        { duration: 400 }
      );
    }
  }

  function recenter() {
    fitMap();
  }

  // ── Route fetching ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!providerLocation || !customerLocation) {
      setRoute(null);
      clearRouteTimer();
      return;
    }

    fetchRoute(providerLocation, customerLocation);

    routeTimerRef.current = setInterval(
      () => fetchRoute(providerLocation, customerLocation),
      ROUTE_INTERVAL_MS
    );

    return clearRouteTimer;
  }, [
    providerLocation?.lat,
    providerLocation?.lng,
    customerLocation?.lat,
    customerLocation?.lng,
  ]);

  function clearRouteTimer() {
    if (routeTimerRef.current) {
      clearInterval(routeTimerRef.current);
      routeTimerRef.current = null;
    }
  }

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

  // ── Helpers ───────────────────────────────────────────────────────────────

  function initials(name?: string) {
    if (!name) return 'DR';
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!initialRegion) {
    return (
      <View style={styles.placeholder}>
        <Feather name="map-pin" size={32} color="#D1D5DB" />
        <Text style={styles.placeholderText}>Waiting for location...</Text>
      </View>
    );
  }

  const providerTitle = route ? `Driver · ${route.distanceText} away` : 'Driver';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* ── Full-screen map ── */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        mapType="standard"
        style={StyleSheet.absoluteFillObject}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        onRegionChangeComplete={(r) => { regionRef.current = r; }}
      >
        {/* White outline behind route */}
        {route && route.coords.length > 0 && (
          <Polyline coordinates={route.coords} strokeColor="#ffffff" strokeWidth={10} />
        )}
        {/* Green route */}
        {route && route.coords.length > 0 && (
          <Polyline coordinates={route.coords} strokeColor={PRIMARY} strokeWidth={6} />
        )}

        {/* ── Driver marker ── green circle, rotates with heading */}
        {providerLocation && (
          <Marker
            coordinate={{ latitude: providerLocation.lat, longitude: providerLocation.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={providerHeading ?? 0}
            tracksViewChanges={false}
          >
            <View style={styles.driverMarker}>
              <Feather name="truck" size={18} color="#fff" />
            </View>
          </Marker>
        )}

        {/* ── Destination marker ── green teardrop pin */}
        {customerLocation && (
          <Marker
            coordinate={{ latitude: customerLocation.lat, longitude: customerLocation.lng }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
          >
            <View style={styles.destPin}>
              <View style={styles.destPinHead}>
                <View style={styles.destPinDot} />
              </View>
              <View style={styles.destPinTail} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* ── Back button ── top left */}
      {onBack && (
        <TouchableOpacity style={styles.backBtn} onPress={onBack} hitSlop={8} activeOpacity={0.85}>
          <Feather name="chevron-left" size={24} color="#374151" />
        </TouchableOpacity>
      )}

      {/* ── Recenter button ── bottom right, above card */}
      <TouchableOpacity style={styles.recenterBtn} onPress={recenter} hitSlop={8} activeOpacity={0.85}>
        <Feather name="crosshair" size={20} color="#374151" />
      </TouchableOpacity>

      {/* ── Bottom card ── */}
      <View style={styles.card}>
        {/* Drag handle */}
        <View style={styles.handle} />

        {/* ETA row */}
        <View style={styles.etaRow}>
          <View style={styles.etaLeft}>
            <Text style={styles.etaTitle}>{providerName ?? 'Driver'}</Text>
            {deliveryAddress ? (
              <Text style={styles.etaAddress} numberOfLines={1}>{deliveryAddress}</Text>
            ) : null}
          </View>
          {route && (
            <View style={styles.etaBadge}>
              <Text style={styles.etaBadgeLabel}>ETA </Text>
              <Text style={styles.etaBadgeTime}>{route.durationText}</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        {/* Action buttons */}
        {(onCall || onChat) && (
          <View style={styles.actionRow}>
            {onCall && (
              <TouchableOpacity style={[styles.actionBtn, styles.callBtn]} onPress={onCall} activeOpacity={0.8}>
                <Feather name="phone" size={16} color="#fff" />
                <Text style={[styles.actionBtnText, styles.callBtnText]}>Call</Text>
              </TouchableOpacity>
            )}
            {onChat && (
              <TouchableOpacity style={styles.actionBtn} onPress={onChat} activeOpacity={0.8}>
                <Feather name="message-circle" size={16} color="#374151" />
                <Text style={styles.actionBtnText}>Chat</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CARD_APPROX_HEIGHT = 240;

const styles = StyleSheet.create({
  container: { flex: 1 },

  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#F3F4F6',
  },
  placeholderText: { fontSize: 14, color: '#9CA3AF' },

  // ── Driver marker ────────────────────────────────────────────────────────
  driverMarker: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },

  // ── Destination marker ───────────────────────────────────────────────────
  destPin: {
    alignItems: 'center',
  },
  destPinHead: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  destPinDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  destPinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#16A34A',
    marginTop: -1,
  },

  // ── Back button ─────────────────────────────────────────────────────────
  backBtn: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },

  // ── Recenter button ──────────────────────────────────────────────────────
  recenterBtn: {
    position: 'absolute',
    right: 16,
    bottom: CARD_APPROX_HEIGHT + 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },

  // ── Bottom card ──────────────────────────────────────────────────────────
  card: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 16,
  },

  // Drag handle
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },

  // ETA row
  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  etaLeft: { flex: 1 },
  etaTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 },
  etaAddress: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  etaBadge: {
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  etaBadgeLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  etaBadgeTime: { fontSize: 14, fontWeight: '700', color: '#111827' },

  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginBottom: 16,
  },

  // Provider row
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#DCFCE7',
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: PRIMARY },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 2 },
  businessName: { fontSize: 12, color: '#6B7280', marginBottom: 2 },
  distanceText: { fontSize: 14, fontWeight: '700', color: '#374151' },

  // Action buttons
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  callBtn: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  callBtnText: { color: '#fff' },
});
