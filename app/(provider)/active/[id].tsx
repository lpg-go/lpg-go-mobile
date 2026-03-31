import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import LiveMap from '../../../components/LiveMap';
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
  customer: { full_name: string; phone: string } | null;
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
  pending:                   { label: 'Waiting...',            color: '#6B7280', bg: '#F3F4F6' },
  awaiting_dealer_selection: { label: 'Finding Provider',      color: '#D97706', bg: '#FEF3C7' },
  in_transit:                { label: 'On the Way!',           color: '#2563EB', bg: '#DBEAFE' },
  awaiting_confirmation:     { label: 'Awaiting Confirmation', color: '#7C3AED', bg: '#EDE9FE' },
  delivered:                 { label: 'Delivered',             color: '#16A34A', bg: '#DCFCE7' },
  cancelled:                 { label: 'Cancelled',             color: '#DC2626', bg: '#FEE2E2' },
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [newMsgBanner, setNewMsgBanner] = useState<string | null>(null);

  // Location tracking
  const [providerLocation, setProviderLocation] = useState<LatLng | null>(null);
  const [customerLocation, setCustomerLocation] = useState<LatLng | null>(null);
  const [providerHeading, setProviderHeading] = useState<number | null>(null);
  const [mapVisible, setMapVisible] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    fetchAll();
    subscribeToOrder();
    return () => { channelRef.current?.unsubscribe(); };
  }, [id]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
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
          setUnreadCount((prev) => prev + 1);
          const senderName = order?.customer?.full_name ?? 'Customer';
          setNewMsgBanner(`New message from ${senderName}`);
          if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
          bannerTimerRef.current = setTimeout(() => setNewMsgBanner(null), 3000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [currentUserId, id]);

  // Start / stop GPS tracking based on order status
  useEffect(() => {
    if (!currentUserId || !order) return;

    if (order.status === 'in_transit') {
      startLocationTracking(currentUserId);
    } else {
      stopLocationTracking();
    }

    return () => { stopLocationTracking(); };
  }, [order?.status, currentUserId]);

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
      .select('id, status, delivery_address, delivery_lat, delivery_lng, total_amount, admin_fee, customer_id, created_at, customer:profiles!customer_id(full_name, phone)')
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

  async function handleMarkDelivered() {
    setMarking(true);
    const { error } = await supabase
      .from('orders')
      .update({ status: 'awaiting_confirmation' })
      .eq('id', id);
    setMarking(false);
    if (error) Alert.alert('Error', error.message);
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
    router.push({ pathname: '/(provider)/chat/[orderId]', params: { orderId: id } });
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(provider)')} style={styles.backButton} hitSlop={8}>
          <Feather name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Status</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* New message banner */}
      {newMsgBanner && (
        <TouchableOpacity style={styles.msgBanner} onPress={handleChat} activeOpacity={0.85}>
          <Feather name="message-circle" size={14} color="#fff" />
          <Text style={styles.msgBannerText} numberOfLines={1}>{newMsgBanner}</Text>
          <Feather name="chevron-right" size={14} color="#fff" />
        </TouchableOpacity>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}
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
            <Feather name="map-pin" size={13} color="#9CA3AF" style={{ marginTop: 1 }} />
            <Text style={styles.addressText} numberOfLines={2}>{order.delivery_address}</Text>
          </View>
        </View>

        {/* Awaiting confirmation card */}
        {order.status === 'awaiting_confirmation' && (
          <View style={styles.waitingConfirmCard}>
            <ActivityIndicator size="small" color="#7C3AED" />
            <View style={{ flex: 1 }}>
              <Text style={styles.waitingConfirmTitle}>Waiting for customer confirmation</Text>
              <Text style={styles.waitingConfirmSubtitle}>
                The customer needs to confirm they received the order.
              </Text>
            </View>
          </View>
        )}

        {/* Customer */}
        {order.customer && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Customer</Text>
            <View style={styles.customerCard}>
              <View style={styles.customerAvatar}>
                <Feather name="user" size={22} color={PRIMARY} />
              </View>
              <View style={styles.customerInfo}>
                <Text style={styles.customerName}>{order.customer.full_name}</Text>
              </View>
              {order.status === 'in_transit' && (
                <TouchableOpacity style={styles.actionBtn} hitSlop={8} onPress={() => setMapVisible(true)}>
                  <Feather name="map-pin" size={18} color={PRIMARY} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Order items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items Ordered</Text>
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

        {/* Mark as delivered */}
        {order.status === 'in_transit' && (
          <TouchableOpacity
            style={[styles.markDeliveredBtn, marking && { opacity: 0.6 }]}
            onPress={handleMarkDelivered}
            disabled={marking}
          >
            {marking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="check-circle" size={18} color="#fff" />
                <Text style={styles.markDeliveredBtnText}>Mark as Delivered</Text>
              </>
            )}
          </TouchableOpacity>
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

      {/* Map modal */}
      <Modal visible={mapVisible} animationType="slide" onRequestClose={() => setMapVisible(false)}>
        <View style={[styles.modalScreen, { paddingTop: insets.top }]}>
          <LiveMap
            providerLocation={providerLocation}
            customerLocation={customerLocation}
            providerHeading={providerHeading}
            providerName={order.customer?.full_name}
            deliveryAddress={order.delivery_address}
            onBack={() => setMapVisible(false)}
            onChat={() => { setMapVisible(false); handleChat(); }}
            onCall={handleCall}
          />
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 15, color: '#6B7280' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PADDING,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: { width: 34 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },

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
  orderId: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 2 },
  placedAt: { fontSize: 12, color: '#9CA3AF', marginBottom: 10 },
  addressRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 8 },
  addressText: { fontSize: 13, color: '#6B7280', flex: 1, textAlign: 'center' },

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
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  customerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  customerInfo: { flex: 1 },
  customerName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  customerActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },

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

  // Message banner
  msgBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  msgBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#fff' },

  // Mark delivered
  markDeliveredBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
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

  // Map modal
  modalScreen: { flex: 1, backgroundColor: '#000' },
});
