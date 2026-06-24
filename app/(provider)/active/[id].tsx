import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppHeader from '../../../components/AppHeader';
import ChatModal from '../../../components/ChatModal';
import LiveMap from '../../../components/LiveMap';
import SheetHeader from '../../../components/SheetHeader';
import ProviderHeaderActions from '../../../components/ProviderHeaderActions';
import { sendOrderNotification } from '../../../lib/notifications';
import { speedLabel } from '../../../lib/reviewSpeed';
import { SAFETY_ITEMS } from '../../../lib/safety';
import supabase from '../../../lib/supabase';

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
  delivery_address: string;
  delivery_lat: number | null;
  delivery_lng: number | null;
  total_amount: number;
  admin_fee: number;
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

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  pending:                   { label: 'Waiting...',            color: '#16A34A', bg: '#F0FDF4' },
  awaiting_dealer_selection: { label: 'Finding Provider',      color: '#16A34A', bg: '#F0FDF4' },
  in_transit:                { label: 'On the Way',           color: '#16A34A', bg: '#F0FDF4' },
  awaiting_confirmation:     { label: 'Awaiting Confirmation', color: '#16A34A', bg: '#F0FDF4' },
  delivered:                 { label: 'Delivered',             color: '#FFFFFF', bg: '#16A34A' },
  cancelled:                 { label: 'Cancelled',             color: '#FFFFFF', bg: '#DC2626' },
};

const H_PADDING = 20;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ActiveDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

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
  const [checks, setChecks] = useState<boolean[]>([false, false, false]);
  const [safetyNotes, setSafetyNotes] = useState('');

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
      .select('id, status, delivery_address, delivery_lat, delivery_lng, total_amount, admin_fee, customer_id, created_at, customer:profiles!customer_id(full_name, phone, avatar_url)')
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
    setChecks([false, false, false]);
    setSafetyNotes('');
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
    const trimmedNotes = safetyNotes.trim();

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
        notes: trimmedNotes || null,
      });

    if (checkError) {
      setMarking(false);
      Alert.alert('Error', checkError.message);
      return; // Do NOT update the order if the check failed to record.
    }

    // 2. Check recorded — proceed with the existing mark-as-delivered flow.
    const { error: orderError } = await supabase
      .from('orders')
      .update({ status: 'awaiting_confirmation', delivery_completed_at: new Date().toISOString() })
      .eq('id', id);

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

    const { error } = await supabase
      .from('orders')
      .update({ status: 'awaiting_dealer_selection', selected_provider_id: null })
      .eq('id', id);

    console.log('Cancel error:', JSON.stringify(error));
    setCancelling(false);

    if (error) {
      Alert.alert(
        'Cancel Failed',
        `Error: ${error.message}\nCode: ${error.code}\nOrder: ${id}\nUser: ${user?.id}`
      );
      return;
    }

    if (user?.id) {
      await supabase
        .from('order_acceptances')
        .update({ withdrawn_at: new Date().toISOString() })
        .eq('order_id', id)
        .eq('provider_id', user.id);
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
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>Order not found.</Text>
      </View>
    );
  }

  const statusCfg = STATUS_CONFIG[order.status];
  const shortId = order.id.slice(-8).toUpperCase();
  const placedAt = new Date(order.created_at).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const isActive = order.status !== 'delivered' && order.status !== 'cancelled';
  // Dealers don't broadcast location, so the live map serves no purpose for them.
  const isRider = providerType === 'rider';

  // "Confirm Delivery" is allowed when either all items pass (notes optional),
  // or at least one item failed but the rider explained why in the notes.
  const allChecked = checks.every(Boolean);
  const notesLong = safetyNotes.trim().length >= 10;
  const canConfirm = allChecked || notesLong;

  return (
    <View style={styles.screen}>
      <AppHeader showLogo logoHref="/(provider)" right={<ProviderHeaderActions />} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (order.status === 'in_transit' ? 110 : 40) + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Status card */}
        <View style={styles.statusCard}>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusCfg.color }]}>
              {statusCfg.label}
            </Text>
          </View>
          <Text style={styles.orderId}>Order #{shortId}</Text>
          <Text style={styles.placedAt}>Placed {placedAt}</Text>
          <View style={styles.addressRow}>
            <Text style={styles.addressText} numberOfLines={2}>{order.delivery_address}</Text>
          </View>
        </View>

        {/* Customer */}
        {order.customer && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Customer</Text>
            <TouchableOpacity
              style={styles.customerCard}
              activeOpacity={0.8}
              onPress={() => setMapVisible(true)}
              disabled={order.status !== 'in_transit' || !isRider}
            >
              <View style={styles.customerAvatar}>
                {order.customer.avatar_url ? (
                  <Image source={{ uri: order.customer.avatar_url }} style={styles.avatarImage} />
                ) : (
                  <Feather name="user" size={22} color={PRIMARY} />
                )}
              </View>
              <View style={styles.customerInfo}>
                <Text style={styles.customerName}>{order.customer.full_name}</Text>
              </View>
              {(order.status === 'in_transit' || order.status === 'awaiting_confirmation') && (
              <View style={styles.customerActions}>
                {order.customer.phone ? (
                  <TouchableOpacity style={styles.customerIconBtn} onPress={handleCall} hitSlop={6} activeOpacity={0.7}>
                    <Feather name="phone" size={22} color={PRIMARY} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.customerIconBtn} onPress={handleChat} hitSlop={6} activeOpacity={0.7}>
                  <Feather name="message-circle" size={22} color={PRIMARY} />
                  {unreadCount > 0 && (
                    <View style={styles.chatBadge}>
                      <Text style={styles.chatBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
                {order.status === 'in_transit' && isRider && (
                  <TouchableOpacity style={styles.customerIconBtn} onPress={() => setMapVisible(true)} hitSlop={6} activeOpacity={0.7}>
                    <Feather name="map-pin" size={22} color={PRIMARY} />
                  </TouchableOpacity>
                )}
              </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Order items */}
        <View style={styles.section}>

          <View style={styles.itemsCard}>
            {items.map((item, index) => (
              <View
                key={item.id}
                style={[styles.itemRow, index < items.length - 1 && styles.itemRowBorder]}
              >
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.product?.name ?? 'Product'}
                </Text>
                <Text style={styles.itemQty}>×{item.quantity}</Text>
                <Text style={styles.itemSubtotal}>
                  ₱{Number(item.subtotal).toLocaleString()}
                </Text>
              </View>
            ))}
            <View style={styles.itemTotalRow}>
              <Text style={styles.itemTotalLabel}>Total</Text>
              <Text style={styles.itemTotalValue}>
                ₱{Number(order.total_amount).toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        {/* Customer review */}
        {order.status === 'delivered' && (
          <View style={styles.completedCard}>
            {customerReview ? (
              <>
                <Feather name="check-circle" size={20} color={PRIMARY} />
                <Text style={styles.reviewDoneTitle}>Customer Review</Text>
                <View style={styles.reviewStarsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Feather key={s} name="star" size={16} color={s <= customerReview.rating ? '#FBBF24' : '#E5E7EB'} />
                  ))}
                </View>
                {customerReview.comment ? (
                  <Text style={styles.reviewComment}>"{customerReview.comment}"</Text>
                ) : null}
                {speedLabel(customerReview.delivery_speed) ? (
                  <Text style={styles.reviewSpeedText}>Speed: {speedLabel(customerReview.delivery_speed)}</Text>
                ) : null}
              </>
            ) : (
              <>
                <Feather name="star" size={20} color="#D1D5DB" />
                <Text style={styles.reviewDoneTitle}>Customer Review</Text>
                <Text style={styles.reviewPending}>Waiting for customer review...</Text>
              </>
            )}
          </View>
        )}

        {/* Cancel delivery */}
        {order.status === 'in_transit' && (
          <TouchableOpacity
            style={[styles.cancelBtn, cancelling && { opacity: 0.5 }]}
            onPress={confirmCancelDelivery}
            disabled={cancelling}
          >
            {cancelling ? (
              <ActivityIndicator size="small" color="#DC2626" />
            ) : (
              <Text style={styles.cancelBtnText}>Cancel Delivery</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Mark as delivered — fixed bottom bar */}
      {order.status === 'in_transit' && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={[styles.markDeliveredBtn, marking && { opacity: 0.6 }]}
            onPress={openSafetyCheck}
            disabled={marking}
          >
            <Text style={styles.markDeliveredBtnText}>Mark as Delivered</Text>
          </TouchableOpacity>
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
                  style={styles.checkRow}
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

            <Text style={styles.notesLabel}>Notes (required if any item failed — describe the issue briefly)</Text>
            <TextInput
              style={styles.notesInput}
              value={safetyNotes}
              onChangeText={setSafetyNotes}
              placeholder="Describe any issue with the cylinder..."
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={500}
              editable={!marking}
            />

            <View style={styles.safetyActions}>
              <TouchableOpacity
                style={[styles.safetyCancelBtn, marking && { opacity: 0.5 }]}
                onPress={() => setSafetyVisible(false)}
                disabled={marking}
              >
                <Text style={styles.safetyCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.safetyConfirmBtn, (!canConfirm || marking) && styles.safetyConfirmBtnDisabled]}
                onPress={submitSafetyCheck}
                disabled={!canConfirm || marking}
              >
                {marking ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.safetyConfirmText}>Confirm Delivery</Text>
                )}
              </TouchableOpacity>
            </View>
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

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 15, color: '#6B7280' },


  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 16 },

  // Status card
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginBottom: 12,
  },
  statusBadgeText: { fontSize: 16, fontWeight: '700' },
  orderId: { fontSize: 13, fontWeight: '400', color: '#6B7280', marginBottom: 2 },
  placedAt: { fontSize: 12, color: '#9CA3AF', marginBottom: 10 },
  addressRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 8 },
  addressText: { fontSize: 13, fontWeight: '700', color: '#6B7280', flex: 1, textAlign: 'center' },

  // Awaiting confirmation card
  waitingConfirmCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#EDE9FE',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    padding: 16,
    marginBottom: 16,
  },
  waitingConfirmTitle: { fontSize: 15, fontWeight: '700', color: '#5B21B6', marginBottom: 4 },
  waitingConfirmSubtitle: { fontSize: 13, color: '#7C3AED', lineHeight: 18 },

  // Section
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },

  // Customer card
  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  customerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  avatarImage: { width: 40, height: 40, borderRadius: 20 },
  customerInfo: { flex: 1 },
  customerName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  customerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  chatBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },

  // Chat badge
  chatBtnWrapper: { position: 'relative' },
  unreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  unreadBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },

  // Items card
  itemsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  itemName: { flex: 1, fontSize: 13, color: '#374151' },
  itemQty: { fontSize: 13, color: '#9CA3AF', marginHorizontal: 12 },
  itemSubtotal: { fontSize: 13, fontWeight: '600', color: '#111827', minWidth: 64, textAlign: 'right' },
  itemTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  itemTotalLabel: { fontSize: 13, fontWeight: '700', color: '#111827' },
  itemTotalValue: { fontSize: 14, fontWeight: '800', color: PRIMARY },

  // Mark delivered — fixed bottom bar (matches customer Select Provider button)
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: H_PADDING,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  markDeliveredBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  markDeliveredBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Cancel
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 8,
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: '#DC2626' },

  // Customer review card
  completedCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
    gap: 8,
  },
  reviewDoneTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  reviewStarsRow: { flexDirection: 'row', gap: 6 },
  reviewComment: { fontSize: 12, color: '#6B7280', textAlign: 'center' },
  reviewSpeedText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  reviewPending: { fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' },

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
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: H_PADDING,
    paddingTop: 20,
  },
  safetyTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  safetySubtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  checkList: { marginTop: 16, gap: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  checkLabel: { fontSize: 15, color: '#111827', marginLeft: 12, flex: 1 },
  notesLabel: { fontSize: 13, color: '#6B7280', marginTop: 16, marginBottom: 6 },
  notesInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    fontSize: 14,
    color: '#111827',
    textAlignVertical: 'top',
  },
  safetyActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  safetyCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyCancelText: { fontSize: 16, fontWeight: '600', color: '#374151' },
  safetyConfirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyConfirmBtnDisabled: { opacity: 0.5 },
  safetyConfirmText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
