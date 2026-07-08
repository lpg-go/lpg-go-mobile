import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ChatModal from '../../../components/ChatModal';
import OrderItemsCard from '../../../components/order/OrderItemsCard';
import OrderStatusTimeline from '../../../components/order/OrderStatusTimeline';
import LiveMap from '../../../components/LiveMap';
import SheetHeader from '../../../components/SheetHeader';
import Card from '../../../components/ui/Card';
import DetailHeader from '../../../components/ui/DetailHeader';
import PartyCard from '../../../components/ui/PartyCard';
import PrimaryButton from '../../../components/ui/PrimaryButton';
import StatusBadge from '../../../components/ui/StatusBadge';
import { sendOrderNotification } from '../../../lib/notifications';
import { speedLabel } from '../../../lib/reviewSpeed';
import { SAFETY_ITEMS } from '../../../lib/safety';
import supabase from '../../../lib/supabase';
import { colors, radii, shadows, spacing, typography } from '../../../lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus =
  | 'pending'
  | 'awaiting_dealer_selection'
  | 'in_transit'
  | 'awaiting_confirmation'
  | 'delivered'
  | 'cancelled';

type Order = {
  id: string;
  status: OrderStatus;
  payment_method: string | null;
  delivery_address: string;
  delivery_lat: number | null;
  delivery_lng: number | null;
  total_amount: number;
  admin_fee: number;
  is_express: boolean;
  express_fee: number;
  eta_minutes: number | null;
  eta_deadline: string | null;
  customer_id: string;
  created_at: string;
  customer: { full_name: string; phone: string; avatar_url: string | null } | null;
};

type OrderItem = {
  id: string;
  quantity: number;
  subtotal: number;
  product: { name: string } | null;
};

type LatLng = { lat: number; lng: number };

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Waiting...',
  awaiting_dealer_selection: 'Finding Provider',
  in_transit: 'On the Way',
  awaiting_confirmation: 'Awaiting Confirmation',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const H_PADDING = 20;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ActiveDeliveryScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const insets = useSafeAreaInsets();

  // Back target: history items (from Recent Orders) return there; otherwise fall
  // back to the previous screen, then home.
  const handleBack = () =>
    from === 'recent-orders'
      ? router.replace('/(provider)/recent-orders')
      : router.canGoBack()
        ? router.back()
        : router.replace('/(provider)');

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [providerType, setProviderType] = useState<'dealer' | 'rider' | null>(null);
  const [customerReview, setCustomerReview] = useState<{ rating: number; comment: string | null; delivery_speed: string | null; customerName: string | null } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatVisible, setChatVisible] = useState(false);

  // Safety check sheet (gates "Mark as Delivered")
  const [safetyVisible, setSafetyVisible] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([false, false]);

  // Location tracking
  const [providerLocation, setProviderLocation] = useState<LatLng | null>(null);
  const [customerLocation, setCustomerLocation] = useState<LatLng | null>(null);
  const [providerHeading, setProviderHeading] = useState<number | null>(null);
  const [mapVisible, setMapVisible] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  // Reset review state whenever the order id changes
  useEffect(() => {
    setCustomerReview(null);
  }, [id]);

  useEffect(() => {
    fetchAll();
    subscribeToOrder();
    return () => { channelRef.current?.unsubscribe(); };
  }, [id]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setCurrentUserId(user.id);
      // provider_type never changes after signup — fetch once on mount.
      supabase
        .from('profiles')
        .select('provider_type')
        .eq('id', user.id)
        .single()
        .then(({ data }) => setProviderType((data?.provider_type as 'dealer' | 'rider' | null) ?? null));
    });
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`active-messages-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${id}` },
        (payload) => {
          const msg = payload.new as { sender_id: string };
          if (msg.sender_id === currentUserId) return;
          // Bumps the chat unread badge. The in-app message banner is now the
          // global NotificationBanner (driven by the new_message notification row).
          setUnreadCount((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, id]);

  // Start / stop GPS tracking based on order status.
  // Only riders broadcast location — dealers never share their position.
  useEffect(() => {
    if (!currentUserId || !order) return;

    if (order.status === 'in_transit' && providerType === 'rider') {
      startLocationTracking(currentUserId);
    } else {
      stopLocationTracking();
    }

    return () => { stopLocationTracking(); };
  }, [order?.status, currentUserId, providerType]);

  // Fetch customer review when order is delivered + listen for new review in realtime
  useEffect(() => {
    if (order?.status !== 'delivered') return;

    const orderId = id;

    // Initial fetch for THIS specific order
    supabase
      .from('reviews')
      .select('rating, comment, delivery_speed, customer:profiles!customer_id(full_name)')
      .eq('order_id', orderId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const customer = data.customer as { full_name: string } | null;
          setCustomerReview({ rating: data.rating, comment: data.comment, delivery_speed: data.delivery_speed ?? null, customerName: customer?.full_name ?? null });
        }
      });

    // Realtime: update as soon as customer submits review for THIS order
    const channel = supabase
      .channel(`review-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reviews', filter: `order_id=eq.${orderId}` },
        (payload) => {
          const r = payload.new as { rating: number; comment: string | null; delivery_speed: string | null; customer_id: string };
          supabase
            .from('profiles')
            .select('full_name')
            .eq('id', r.customer_id)
            .single()
            .then(({ data }) => {
              setCustomerReview({ rating: r.rating, comment: r.comment, delivery_speed: r.delivery_speed ?? null, customerName: data?.full_name ?? null });
            });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [order?.status, id]);

  // Set customer marker from stored GPS coords; fall back to geocoding if absent
  useEffect(() => {
    if (!order) return;
    if (order.delivery_lat != null && order.delivery_lng != null) {
      setCustomerLocation({ lat: order.delivery_lat, lng: order.delivery_lng });
    } else if (order.delivery_address) {
      geocodeAddress(order.delivery_address);
    }
  }, [order?.id]);

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchAll() {
    await Promise.all([fetchOrder(), fetchItems()]);
    setLoading(false);
  }

  async function fetchOrder() {
    const { data } = await supabase
      .from('orders')
      .select('id, status, payment_method, delivery_address, delivery_lat, delivery_lng, total_amount, admin_fee, is_express, express_fee, eta_minutes, eta_deadline, customer_id, created_at, customer:profiles!customer_id(full_name, phone, avatar_url)')
      .eq('id', id)
      .single();
    if (!data) return;
    setOrder(data as unknown as Order);
  }

  async function fetchItems() {
    const { data } = await supabase
      .from('order_items')
      .select('id, quantity, subtotal, product:products(name)')
      .eq('order_id', id);
    if (data) setItems(data as unknown as OrderItem[]);
  }

  // ── Realtime ──────────────────────────────────────────────────────────────

  function subscribeToOrder() {
    channelRef.current = supabase
      .channel(`active-order:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        (payload) => {
          setOrder((prev) => prev ? { ...prev, ...(payload.new as Partial<Order>) } : prev);
        }
      )
      .subscribe();
  }

  // ── Location tracking ─────────────────────────────────────────────────────

  async function startLocationTracking(uid: string) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Location permission is needed to share your position with the customer.');
      return;
    }

    // Get initial position immediately so the map shows right away
    try {
      const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude: lat, longitude: lng } = initial.coords;
      setProviderLocation({ lat, lng });
      await supabase
        .from('provider_locations')
        .upsert(
          { provider_id: uid, lat, lng, updated_at: new Date().toISOString() },
          { onConflict: 'provider_id' }
        );

      // Now that we have a first location fix, ask the backend to compute the
      // express ETA. Fire-and-forget — set_order_eta is best-effort and returns
      // silently for non-express / non-rider orders, so a failure here must
      // never block location tracking.
      void supabase.rpc('set_order_eta', { p_order_id: id });

      // Give set_order_eta a few seconds to finish, then re-fetch so the ETA
      // fields (eta_minutes / eta_deadline) show up on the card.
      if (order?.is_express) {
        setTimeout(() => {
          void supabase.rpc('set_order_eta', { p_order_id: id });
          fetchOrder();
        }, 8000);
      }
    } catch {
      // Fall through to watch-based updates
    }

    locationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,
        distanceInterval: 5,
      },
      async (loc) => {
        const { latitude: lat, longitude: lng, heading } = loc.coords;
        setProviderLocation({ lat, lng });
        if (heading != null) setProviderHeading(heading);

        await supabase
          .from('provider_locations')
          .upsert(
            { provider_id: uid, lat, lng, updated_at: new Date().toISOString() },
            { onConflict: 'provider_id' }
          );
      }
    );
  }

  function stopLocationTracking() {
    locationSubRef.current?.remove();
    locationSubRef.current = null;
  }

  async function geocodeAddress(address: string) {
    try {
      const results = await Location.geocodeAsync(address);
      if (results.length > 0) {
        setCustomerLocation({ lat: results[0].latitude, lng: results[0].longitude });
      }
    } catch {
      // Geocoding failed — map will just show provider marker
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  // Open the safety check sheet (fresh state each time) instead of marking
  // the order delivered directly.
  function openSafetyCheck() {
    setChecks([false, false]);
    setSafetyVisible(true);
  }

  function toggleCheck(index: number) {
    setChecks((prev) => prev.map((c, i) => (i === index ? !c : c)));
  }

  async function submitSafetyCheck() {
    if (!currentUserId) {
      Alert.alert('Error', 'Unable to identify your account. Please try again.');
      return;
    }

    const passed = checks.every(Boolean);

    setMarking(true);

    // 1. Record the safety check first. RLS enforces that only the assigned
    //    rider can insert, and only while the order is in_transit. A duplicate
    //    (already-checked) order surfaces here as an insert error.
    const { error: checkError } = await supabase
      .from('delivery_safety_checks')
      .insert({
        order_id: id,
        rider_id: currentUserId,
        passed,
        notes: null,
      });

    if (checkError) {
      setMarking(false);
      Alert.alert('Error', checkError.message);
      return; // Do NOT update the order if the check failed to record.
    }

    // 2. Check recorded — proceed with the existing mark-as-delivered flow.
    const { error: orderError } = await supabase.rpc('mark_delivered', { p_order_id: id });

    setMarking(false);

    if (orderError) {
      Alert.alert('Error', orderError.message);
      return;
    }

    setSafetyVisible(false);
    sendOrderNotification(id, 'awaiting_confirmation');
  }

  function confirmCancelDelivery() {
    Alert.alert(
      'Cancel Delivery',
      'Are you sure you want to cancel this delivery? The order will be returned to the queue.',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes, Cancel', style: 'destructive', onPress: cancelDelivery },
      ]
    );
  }

  async function cancelDelivery() {
    setCancelling(true);

    const { data: { user } } = await supabase.auth.getUser();
    console.log('Cancel delivery — Order ID:', id);
    console.log('Cancel delivery — Current user:', user?.id);

    const { error } = await supabase.rpc('provider_withdraw', { p_order_id: id });

    console.log('Cancel error:', JSON.stringify(error));
    setCancelling(false);

    if (error) {
      Alert.alert(
        'Cancel Failed',
        `Error: ${error.message}\nCode: ${error.code}\nOrder: ${id}\nUser: ${user?.id}`
      );
      return;
    }

    sendOrderNotification(id, 'provider_unavailable');
    router.replace('/(provider)');
  }

  function handleCall() {
    if (!order?.customer?.phone) return;
    Linking.openURL(`tel:${order.customer.phone}`).catch(() =>
      Alert.alert('Error', 'Unable to open phone app.')
    );
  }

  function handleChat() {
    setUnreadCount(0);
    setChatVisible(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.screen}>
        <DetailHeader title="Active Delivery" onBack={handleBack} />
        <View style={[styles.screen, styles.centered]}>
          <Text style={styles.errorText}>Order not found.</Text>
        </View>
      </View>
    );
  }

  const shortId = order.id.slice(-8).toUpperCase();
  const placedAt = new Date(order.created_at).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  // Dealers don't broadcast location, so the live map serves no purpose for them.
  const isRider = providerType === 'rider';
  const inTransit = order.status === 'in_transit';
  const callChatActive = order.status === 'in_transit' || order.status === 'awaiting_confirmation';
  const isCOD = order.payment_method !== 'card'; // cash / null default = collect on delivery
  const locationActive = isRider && inTransit && providerLocation != null;

  // "Confirm Delivery" is allowed only when every safety item passes.
  const canConfirm = checks.every(Boolean);

  return (
    <View style={styles.screen}>
      <DetailHeader
        title={`Order #${shortId}`}
        subtitle={STATUS_LABEL[order.status]}
        onBack={handleBack}
        right={order.is_express ? <StatusBadge label="Express" tone="express" /> : undefined}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (inTransit ? 110 : 40) + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Status timeline */}
        <OrderStatusTimeline
          status={order.status}
          placedAt={placedAt}
          isExpress={order.is_express}
          etaDeadline={order.eta_deadline}
          etaMinutes={order.eta_minutes}
          showAddress={false}
        />

        {/* Location banner — rider, in transit, sharing live */}
        {locationActive && (
          <View style={styles.locBanner}>
            <Feather name="navigation" size={18} color="#185FA5" />
            <View style={styles.locBannerText}>
              <Text style={styles.locBannerTitle}>Sharing your location</Text>
              <Text style={styles.locBannerSub}>Customer can see you on the map</Text>
            </View>
          </View>
        )}

        {/* Deliver to — customer */}
        {order.customer && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Deliver to</Text>
            <PartyCard
              name={order.customer.full_name}
              avatarUrl={order.customer.avatar_url}
              showAvatar={false}
              subtitle={order.delivery_address}
              subtitleIcon="map-pin"
              onCall={callChatActive && order.customer.phone ? handleCall : undefined}
              onChat={callChatActive ? handleChat : undefined}
              chatBadge={unreadCount}
            />
            {isRider && inTransit && (
              <TouchableOpacity
                style={styles.mapBtn}
                onPress={() => setMapVisible(true)}
                activeOpacity={0.7}
              >
                <Feather name="map-pin" size={18} color={colors.primary} />
                <Text style={styles.mapBtnText}>Open live map</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Order */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order</Text>
          <OrderItemsCard
            items={items}
            isExpress={order.is_express}
            expressFee={order.express_fee}
            totalAmount={order.total_amount}
            totalLabel={`Total (${isCOD ? 'COD' : 'Card'})`}
            totalVariant="row"
          />
        </View>

        {/* Customer review (delivered) */}
        {order.status === 'delivered' && (
          <Card style={styles.reviewCard}>
            {customerReview ? (
              <>
                <Feather name="check-circle" size={20} color={colors.primary} />
                <Text style={styles.reviewTitle}>Customer Review</Text>
                <View style={styles.reviewStarsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Feather key={s} name="star" size={16} color={s <= customerReview.rating ? colors.amber : colors.border} />
                  ))}
                </View>
                {customerReview.comment ? (
                  <Text style={styles.reviewComment}>"{customerReview.comment}"</Text>
                ) : null}
                {speedLabel(customerReview.delivery_speed) ? (
                  <Text style={styles.reviewSpeed}>Speed: {speedLabel(customerReview.delivery_speed)}</Text>
                ) : null}
              </>
            ) : (
              <>
                <Feather name="star" size={20} color={colors.grey300} />
                <Text style={styles.reviewTitle}>Customer Review</Text>
                <Text style={styles.reviewPending}>Waiting for customer review...</Text>
              </>
            )}
          </Card>
        )}
      </ScrollView>

      {/* Bottom bar — Cancel + Mark as Delivered (in transit) */}
      {inTransit && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.bottomCancel}>
            <PrimaryButton label="Cancel" variant="danger" onPress={confirmCancelDelivery} loading={cancelling} />
          </View>
          <View style={styles.bottomMark}>
            <PrimaryButton label="Mark as Delivered" onPress={openSafetyCheck} loading={marking} />
          </View>
        </View>
      )}

      {/* Map popup — bottom sheet, like the chat popup */}
      <Modal visible={mapVisible} transparent animationType="slide" onRequestClose={() => setMapVisible(false)}>
        <View style={styles.mapSheetOverlay}>
          <View style={styles.mapSheet}>
            <SheetHeader
              title={order.customer?.full_name || 'Live Tracking'}
              subtitle={`Order #${id.slice(-8).toUpperCase()}`}
              onClose={() => setMapVisible(false)}
            />
            <View style={styles.mapSheetBody}>
              <LiveMap
                providerLocation={providerLocation}
                customerLocation={customerLocation}
                providerHeading={providerHeading}
                providerName={order.customer?.full_name}
                deliveryAddress={order.delivery_address}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Safety check — bottom sheet, gates "Mark as Delivered" */}
      <Modal
        visible={safetyVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!marking) setSafetyVisible(false); }}
      >
        <KeyboardAvoidingView
          style={styles.safetyOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.safetySheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.safetyTitle}>Safety Check</Text>
            <Text style={styles.safetySubtitle}>Please verify before handing over the cylinder</Text>

            <View style={styles.checkList}>
              {SAFETY_ITEMS.map((label, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.checkRow, checks[i] && styles.checkRowChecked]}
                  activeOpacity={0.7}
                  onPress={() => toggleCheck(i)}
                  disabled={marking}
                >
                  <View style={[styles.checkbox, checks[i] && styles.checkboxChecked]}>
                    {checks[i] && <Feather name="check" size={15} color="#fff" />}
                  </View>
                  <Text style={styles.checkLabel}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.safetyConfirm}>
              <PrimaryButton
                label="Confirm & mark delivered"
                onPress={submitSafetyCheck}
                disabled={!canConfirm}
                loading={marking}
              />
            </View>
            <TouchableOpacity
              style={styles.safetyCancel}
              onPress={() => { if (!marking) setSafetyVisible(false); }}
              disabled={marking}
              activeOpacity={0.7}
            >
              <Text style={styles.safetyCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ChatModal
        visible={chatVisible}
        onClose={() => { setChatVisible(false); setUnreadCount(0); }}
        orderId={id}
        currentUserId={currentUserId ?? ''}
        otherUserName={order?.customer?.full_name ?? 'Customer'}
        role="provider"
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 15, color: colors.textSecondary },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg },

  // Location banner (blue info)
  locBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#DBEAFE',
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  locBannerText: { flex: 1 },
  locBannerTitle: { fontSize: 13, fontWeight: '700', color: '#185FA5' },
  locBannerSub: { fontSize: 12, color: '#185FA5', marginTop: 1 },

  // Section
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    marginTop: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  mapBtnText: { fontSize: 16, fontWeight: '600', color: colors.primary },

  // Customer review card
  reviewCard: { padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center', gap: spacing.sm },
  reviewTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  reviewStarsRow: { flexDirection: 'row', gap: 6 },
  reviewComment: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  reviewSpeed: { fontSize: 12, fontWeight: '600', color: colors.grey700 },
  reviewPending: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: H_PADDING,
    paddingTop: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.grey100,
  },
  bottomCancel: { flex: 1 },
  bottomMark: { flex: 2 },

  // Map modal
  mapSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  mapSheet: {
    height: '92%',
    backgroundColor: '#000',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  mapSheetBody: { flex: 1 },

  // Safety check sheet
  safetyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  safetySheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: H_PADDING,
    paddingTop: spacing.xl,
  },
  safetyTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  safetySubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  checkList: { marginTop: spacing.lg, gap: spacing.sm },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  checkRowChecked: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.grey300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkLabel: { fontSize: 15, color: colors.text, marginLeft: spacing.md, flex: 1 },
  safetyConfirm: { marginTop: spacing.xl },
  safetyCancel: { paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xs },
  safetyCancelText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
});
