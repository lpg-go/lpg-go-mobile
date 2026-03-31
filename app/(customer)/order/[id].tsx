import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import supabase from '../../../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

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
  payment_method: string;
  delivery_address: string;
  total_amount: number;
  admin_fee: number;
  selected_provider_id: string | null;
  created_at: string;
  expires_at: string | null;
};

type OrderItem = {
  id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  product: { name: string } | null;
};

type Acceptance = {
  id: string;
  provider_id: string;
  accepted_at: string;
  provider: {
    full_name: string;
    business_name: string | null;
    phone: string;
  } | null;
};

type ProviderProfile = {
  id: string;
  full_name: string;
  business_name: string | null;
  phone: string;
};

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; color: string; bg: string }
> = {
  pending:                   { label: 'Waiting...',        color: '#6B7280', bg: '#F3F4F6' },
  awaiting_dealer_selection: { label: 'Finding Provider',  color: '#D97706', bg: '#FEF3C7' },
  in_transit:                { label: 'On the Way!',       color: '#2563EB', bg: '#DBEAFE' },
  awaiting_confirmation:     { label: 'Delivered?',        color: '#7C3AED', bg: '#EDE9FE' },
  delivered:                 { label: 'Delivered',         color: '#16A34A', bg: '#DCFCE7' },
  cancelled:                 { label: 'Cancelled',         color: '#DC2626', bg: '#FEE2E2' },
};

const TIMELINE_STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'pending',                   label: 'Order Placed' },
  { key: 'awaiting_dealer_selection', label: 'Provider Found' },
  { key: 'in_transit',                label: 'In Transit' },
  { key: 'awaiting_confirmation',     label: 'Awaiting Confirmation' },
  { key: 'delivered',                 label: 'Delivered' },
];

const STEP_ORDER: OrderStatus[] = [
  'pending',
  'awaiting_dealer_selection',
  'in_transit',
  'awaiting_confirmation',
  'delivered',
];

function stepIndex(status: OrderStatus) {
  const idx = STEP_ORDER.indexOf(status);
  return idx === -1 ? -1 : idx; // -1 for cancelled
}

// ─── Screen ──────────────────────────────────────────────────────────────────

const H_PADDING = 20;

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectingProvider, setSelectingProvider] = useState<string | null>(null); // provider_id being confirmed
  const [cancelling, setCancelling] = useState(false);

  const orderChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const acceptanceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    fetchAll();
    subscribeToOrder();
    subscribeToAcceptances();

    return () => {
      orderChannelRef.current?.unsubscribe();
      acceptanceChannelRef.current?.unsubscribe();
    };
  }, [id]);

  // Re-fetch provider profile whenever selected_provider_id changes
  useEffect(() => {
    if (order?.selected_provider_id) {
      fetchSelectedProvider(order.selected_provider_id);
    } else {
      setSelectedProvider(null);
    }
  }, [order?.selected_provider_id]);

  // ── Data fetching ────────────────────────────────────────────────────────

  async function fetchAll() {
    await Promise.all([fetchOrder(), fetchItems(), fetchAcceptances()]);
    setLoading(false);
  }

  async function fetchOrder() {
    const { data } = await supabase
      .from('orders')
      .select('id, status, payment_method, delivery_address, total_amount, admin_fee, selected_provider_id, created_at, expires_at')
      .eq('id', id)
      .single();
    if (data) setOrder(data as Order);
  }

  async function fetchItems() {
    const { data } = await supabase
      .from('order_items')
      .select('id, quantity, unit_price, subtotal, product:products(name)')
      .eq('order_id', id);
    if (data) setItems(data as unknown as OrderItem[]);
  }

  async function fetchAcceptances() {
    const { data } = await supabase
      .from('order_acceptances')
      .select('id, provider_id, accepted_at, provider:profiles(full_name, business_name, phone)')
      .eq('order_id', id)
      .is('withdrawn_at', null);
    if (data) setAcceptances(data as unknown as Acceptance[]);
  }

  async function fetchSelectedProvider(providerId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, business_name, phone')
      .eq('id', providerId)
      .single();
    if (data) setSelectedProvider(data as ProviderProfile);
  }

  // ── Realtime ─────────────────────────────────────────────────────────────

  function subscribeToOrder() {
    orderChannelRef.current = supabase
      .channel(`order:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        (payload) => {
          const updated = payload.new as Partial<Order>;
          setOrder((prev) => prev ? { ...prev, ...updated } : prev);
        }
      )
      .subscribe();
  }

  function subscribeToAcceptances() {
    acceptanceChannelRef.current = supabase
      .channel(`acceptances:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_acceptances', filter: `order_id=eq.${id}` },
        () => {
          // Re-fetch full acceptance list (with joined provider profile) on any change
          fetchAcceptances();
        }
      )
      .subscribe();
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleSelectProvider(providerId: string) {
    setSelectingProvider(providerId);

    const { error } = await supabase
      .from('orders')
      .update({ selected_provider_id: providerId, status: 'in_transit' })
      .eq('id', id);

    setSelectingProvider(null);

    if (error) Alert.alert('Error', error.message);
  }

  function confirmCancelOrder() {
    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this order?',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes, Cancel', style: 'destructive', onPress: cancelOrder },
      ]
    );
  }

  async function cancelOrder() {
    setCancelling(true);
    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_by: 'customer' })
      .eq('id', id);
    setCancelling(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    // Update local state immediately in case Realtime is slow
    setOrder((prev) => prev ? { ...prev, status: 'cancelled', selected_provider_id: null } : prev);

    Alert.alert('Order Cancelled', 'Your order has been cancelled.', [
      { text: 'OK', onPress: () => router.replace('/(customer)/orders') },
    ]);
  }

  // ── Render ───────────────────────────────────────────────────────────────

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
  const currentStep = stepIndex(order.status);
  const canCancel = order.status === 'pending' || order.status === 'awaiting_dealer_selection';
  const shortId = order.id.slice(-8).toUpperCase();
  const placedAt = new Date(order.created_at).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const showAcceptances =
    order.status === 'awaiting_dealer_selection' && !order.selected_provider_id;
  const showSelectedProvider =
    order.selected_provider_id !== null &&
    order.status !== 'cancelled';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <Feather name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Status</Text>
        <View style={{ width: 34 }} />
      </View>

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

        {/* Timeline */}
        {order.status !== 'cancelled' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tracking</Text>
            <View style={styles.timeline}>
              {TIMELINE_STEPS.map((step, index) => {
                const done = currentStep > index;
                const active = currentStep === index;
                const isLast = index === TIMELINE_STEPS.length - 1;

                return (
                  <View key={step.key} style={styles.timelineRow}>
                    {/* Left column: dot + connector */}
                    <View style={styles.timelineLeft}>
                      <View
                        style={[
                          styles.timelineDot,
                          done && styles.timelineDotDone,
                          active && styles.timelineDotActive,
                        ]}
                      >
                        {done && <Feather name="check" size={10} color="#fff" />}
                        {active && <View style={styles.timelinePulse} />}
                      </View>
                      {!isLast && (
                        <View style={[styles.timelineConnector, done && styles.timelineConnectorDone]} />
                      )}
                    </View>
                    {/* Label */}
                    <Text
                      style={[
                        styles.timelineLabel,
                        done && styles.timelineLabelDone,
                        active && styles.timelineLabelActive,
                      ]}
                    >
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Provider acceptances */}
        {showAcceptances && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Providers Ready to Deliver</Text>
            {acceptances.length === 0 ? (
              <View style={styles.emptyProviders}>
                <ActivityIndicator size="small" color={PRIMARY} />
                <Text style={styles.emptyProvidersText}>Waiting for providers to accept...</Text>
              </View>
            ) : (
              acceptances.map((acc) => (
                <ProviderCard
                  key={acc.id}
                  acceptance={acc}
                  selecting={selectingProvider === acc.provider_id}
                  onSelect={() => handleSelectProvider(acc.provider_id)}
                />
              ))
            )}
          </View>
        )}

        {/* Selected provider */}
        {showSelectedProvider && selectedProvider && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Provider</Text>
            <View style={styles.selectedProviderCard}>
              <View style={styles.providerAvatar}>
                <Feather name="user" size={22} color={PRIMARY} />
              </View>
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>{selectedProvider.full_name}</Text>
                {selectedProvider.business_name && (
                  <Text style={styles.providerBusiness}>{selectedProvider.business_name}</Text>
                )}
              </View>
              <View style={styles.providerActions}>
                <TouchableOpacity style={styles.providerActionBtn} hitSlop={8}>
                  <Feather name="phone" size={18} color={PRIMARY} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.providerActionBtn} hitSlop={8}>
                  <Feather name="message-circle" size={18} color={PRIMARY} />
                </TouchableOpacity>
              </View>
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
                <Text style={styles.itemSubtotal}>₱{Number(item.subtotal).toLocaleString()}</Text>
              </View>
            ))}
            <View style={styles.itemTotalRow}>
              <Text style={styles.itemTotalLabel}>Total</Text>
              <Text style={styles.itemTotalValue}>₱{Number(order.total_amount).toLocaleString()}</Text>
            </View>
          </View>
        </View>

        {/* Cancel button */}
        {canCancel && (
          <TouchableOpacity
            style={[styles.cancelButton, cancelling && styles.cancelButtonDisabled]}
            onPress={confirmCancelOrder}
            disabled={cancelling}
          >
            {cancelling ? (
              <ActivityIndicator size="small" color="#DC2626" />
            ) : (
              <Text style={styles.cancelButtonText}>Cancel Order</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Provider card ────────────────────────────────────────────────────────────

function ProviderCard({
  acceptance,
  selecting,
  onSelect,
}: {
  acceptance: Acceptance;
  selecting: boolean;
  onSelect: () => void;
}) {
  const provider = acceptance.provider;

  return (
    <View style={styles.providerCard}>
      <View style={styles.providerAvatar}>
        <Feather name="user" size={20} color={PRIMARY} />
      </View>
      <View style={styles.providerInfo}>
        <Text style={styles.providerName}>{provider?.full_name ?? '—'}</Text>
        {provider?.business_name && (
          <Text style={styles.providerBusiness}>{provider.business_name}</Text>
        )}
      </View>
      <TouchableOpacity
        style={[styles.selectBtn, selecting && styles.selectBtnDisabled]}
        onPress={onSelect}
        disabled={selecting}
      >
        {selecting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.selectBtnText}>Select</Text>
        )}
      </TouchableOpacity>
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
  addressRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
  },
  addressText: { fontSize: 13, color: '#6B7280', flex: 1, textAlign: 'center' },

  // Section
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },

  // Timeline
  timeline: { paddingLeft: 4 },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineLeft: { alignItems: 'center', width: 24, marginRight: 14 },
  timelineDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  timelineDotDone: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  timelineDotActive: {
    backgroundColor: '#fff',
    borderColor: PRIMARY,
    borderWidth: 2,
  },
  timelinePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PRIMARY,
  },
  timelineConnector: {
    width: 2,
    height: 32,
    backgroundColor: '#E5E7EB',
    marginVertical: 2,
  },
  timelineConnectorDone: { backgroundColor: PRIMARY },
  timelineLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    paddingTop: 2,
    paddingBottom: 24,
    flex: 1,
  },
  timelineLabelDone: { color: '#6B7280' },
  timelineLabelActive: { color: '#111827', fontWeight: '600' },

  // Provider acceptances
  emptyProviders: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyProvidersText: { fontSize: 13, color: '#6B7280' },
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  selectedProviderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  providerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  providerBusiness: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  providerActions: { flexDirection: 'row', gap: 8 },
  providerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  selectBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 70,
    alignItems: 'center',
  },
  selectBtnDisabled: { opacity: 0.6 },
  selectBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },

  // Order items
  itemsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
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

  // Cancel
  cancelButton: {
    borderWidth: 1,
    borderColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelButtonDisabled: { opacity: 0.5 },
  cancelButtonText: { fontSize: 14, fontWeight: '600', color: '#DC2626' },
});
