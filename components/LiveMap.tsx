import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';

import { decodePolyline } from '../lib/decodePolyline';
import { colors, radii, spacing, typography, shadows } from '../lib/theme';
import Avatar from './ui/Avatar';

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
  /** Compass heading (degrees) from watchPositionAsync to rotate the rider icon */
  providerHeading?: number | null;
  /** Name shown in the bottom card (driver's name for customer view) */
  providerName?: string;
  businessName?: string;
  deliveryAddress?: string;
  /** Provider rating shown in the drawer meta row when provided */
  rating?: number | null;
  /** Provider avatar; falls back to initials when absent */
  avatarUrl?: string | null;
  /** Express orders surface a bolt in the ETA pill */
  isExpress?: boolean;
  onBack?: () => void;
  onChat?: () => void;
  onCall?: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

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
  rating,
  avatarUrl,
  isExpress,
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

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!initialRegion) {
    return (
      <View style={styles.placeholder}>
        <Feather name="map-pin" size={32} color={colors.textFaint} />
        <Text style={styles.placeholderText}>Waiting for location...</Text>
      </View>
    );
  }

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
          <Polyline coordinates={route.coords} strokeColor={colors.primary} strokeWidth={6} />
        )}

        {/* ── Rider marker ── green rounded square, rotates with heading */}
        {providerLocation && (
          <Marker
            coordinate={{ latitude: providerLocation.lat, longitude: providerLocation.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={providerHeading ?? 0}
            tracksViewChanges={false}
          >
            <View style={styles.driverMarker}>
              <MaterialCommunityIcons name="motorbike" size={20} color="#fff" />
            </View>
          </Marker>
        )}

        {/* ── Destination marker ── green teardrop pin with pulsing ring */}
        {customerLocation && (
          <Marker
            coordinate={{ latitude: customerLocation.lat, longitude: customerLocation.lng }}
            anchor={{ x: 0.5, y: 1 }}
            // Must track view changes so the Animated pulse ring actually renders
            // (a static snapshot would freeze it). Cheap here — the pin is fixed.
            tracksViewChanges={true}
          >
            <View style={styles.destPin}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.pulseRing,
                  { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]}
              />
              <View style={styles.destPinHead}>
                <View style={styles.destPinDot} />
              </View>
              <View style={styles.destPinTail} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* ── ETA pill ── top center */}
      <View style={styles.etaPillWrap} pointerEvents="box-none">
        {route && (
          <View style={styles.etaPill}>
            {isExpress && (
              <Feather name="zap" size={14} color={colors.amberTint} style={styles.etaPillIcon} />
            )}
            <Text style={styles.etaPillText}>Arriving in ~{route.durationText}</Text>
          </View>
        )}
      </View>

      {/* ── Back button ── top left */}
      {onBack && (
        <TouchableOpacity style={styles.backBtn} onPress={onBack} hitSlop={8} activeOpacity={0.85}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
      )}

      {/* ── Recenter button ── bottom right, above card */}
      <TouchableOpacity style={styles.recenterBtn} onPress={recenter} hitSlop={8} activeOpacity={0.85}>
        <Feather name="crosshair" size={20} color={colors.primary} />
      </TouchableOpacity>

      {/* ── Bottom drawer ── */}
      <View style={styles.card}>
        <View style={styles.handle} />

        {/* Provider row */}
        <View style={styles.providerRow}>
          <View style={styles.avatarWrap}>
            <Avatar
              url={avatarUrl}
              name={providerName ?? undefined}
              size={48}
              backgroundColor={colors.headerBg}
              textColor={colors.headerAccent}
            />
            <View style={styles.onlineDot} />
          </View>

          <View style={styles.providerInfo}>
            <Text style={styles.providerName} numberOfLines={1}>{providerName ?? 'Driver'}</Text>
            <View style={styles.metaRow}>
              {rating != null && (
                <>
                  <Feather name="star" size={12} color={colors.amber} />
                  <Text style={styles.metaText}>{rating.toFixed(1)}</Text>
                </>
              )}
              {route?.distanceText ? (
                <Text style={styles.metaText}>
                  {rating != null ? ' · ' : ''}{route.distanceText} away
                </Text>
              ) : null}
            </View>
          </View>

          {(onCall || onChat) && (
            <View style={styles.actionRow}>
              {onCall && (
                <TouchableOpacity style={styles.callBtn} onPress={onCall} activeOpacity={0.8}>
                  <Feather name="phone" size={18} color={colors.primary} />
                </TouchableOpacity>
              )}
              {onChat && (
                <TouchableOpacity style={styles.chatBtn} onPress={onChat} activeOpacity={0.8}>
                  <Feather name="message-circle" size={18} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Delivering to strip */}
        {deliveryAddress ? (
          <View style={styles.addressStrip}>
            <Feather name="map-pin" size={16} color={colors.primary} style={styles.addressIcon} />
            <View style={styles.addressTextWrap}>
              <Text style={styles.addressLabel}>Delivering to</Text>
              <Text style={styles.addressText} numberOfLines={2}>{deliveryAddress}</Text>
            </View>
          </View>
        ) : null}
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
    gap: spacing.md,
    backgroundColor: '#F3F4F6',
  },
  placeholderText: { fontSize: 14, color: colors.textMuted },

  // ── Rider marker ─────────────────────────────────────────────────────────
  driverMarker: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    ...shadows.raised,
  },

  // ── Destination marker ───────────────────────────────────────────────────
  destPin: {
    alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    top: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
  },
  destPinHead: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    ...shadows.raised,
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
    borderTopColor: colors.primary,
    marginTop: -1,
  },

  // ── ETA pill (top center) ────────────────────────────────────────────────
  etaPillWrap: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  etaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.headerBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.raised,
  },
  etaPillIcon: { marginRight: spacing.xs },
  etaPillText: { fontSize: 13, fontWeight: '700', color: colors.headerText },

  // ── Back button ─────────────────────────────────────────────────────────
  backBtn: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 42,
    height: 42,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.raised,
  },

  // ── Recenter button ──────────────────────────────────────────────────────
  recenterBtn: {
    position: 'absolute',
    right: 16,
    bottom: CARD_APPROX_HEIGHT + 16,
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.raised,
  },

  // ── Bottom drawer ────────────────────────────────────────────────────────
  card: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    ...shadows.nav,
  },

  // Drag handle
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },

  // Provider row
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.headerBg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: 48, height: 48, borderRadius: radii.pill },
  avatarInitials: { fontSize: 16, fontWeight: '700', color: colors.headerAccent },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 13,
    height: 13,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.card,
  },
  providerInfo: { flex: 1 },
  providerName: { ...typography.cardTitle, color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  metaText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },

  // Action buttons
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Delivering-to strip
  addressStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  addressIcon: { marginTop: 1 },
  addressTextWrap: { flex: 1 },
  addressLabel: { ...typography.label, color: colors.textMuted, marginBottom: 2 },
  addressText: { ...typography.body, color: colors.text },
});
