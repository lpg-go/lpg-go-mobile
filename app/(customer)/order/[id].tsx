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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import LiveMap from '../../../components/LiveMap';
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
  delivery_lat: number | null;
  delivery_lng: number | null;
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
  provider_total: number;
  avgRating: number | null;
  reviewCount: number;
  avgDeliveryMinutes: number | null;
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

type LatLng = { lat: number; lng: number };

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
  const [sortBy, setSortBy] = useState<'price' | 'distance'>('price');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [existingRating, setExistingRating] = useState<number | null>(null);
  const [existingComment, setExistingComment] = useState<string | null>(null);

  // Bug 1 — Reset review state when order id changes
  useEffect(() => {
    setReviewRating(0);
    setReviewComment('');
    setReviewDone(false);
    setExistingRating(null);
    setExistingComment(null);
  }, [id]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [newMsgBanner, setNewMsgBanner] = useState<string | null>(null);

  // Location tracking
  const [providerLocation, setProviderLocation] = useState<LatLng | null>(null);
  const [customerLocation, setCustomerLocation] = useState<LatLng | null>(null);
  const [mapVisible, setMapVisible] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel(`order-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        (payload) => {
          console.log('[Realtime] orders change:', payload);
          if (payload.new) {
            setOrder((prev) => prev ? { ...prev, ...(payload.new as Partial<Order>) } : null);
          }
          fetchOrderAcceptances();
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] channel status:', status);
      });

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Poll order_acceptances every 5s while order is pending/awaiting_dealer_selection
  useEffect(() => {
    const status = order?.status;
    if (status !== 'pending' && status !== 'awaiting_dealer_selection') {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }
    pollIntervalRef.current = setInterval(() => {
      fetchOrderAcceptances();
    }, 5000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [order?.status]);


  // Fetch current user id once on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  // Subscribe to incoming messages for unread badge + banner
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`order-messages-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${id}` },
        (payload) => {
          const msg = payload.new as { sender_id: string };
          if (msg.sender_id === currentUserId) return;

          setUnreadCount((prev) => prev + 1);

          const senderName = selectedProvider?.full_name ?? 'Provider';
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

  // Check for existing review only once order is delivered
  useEffect(() => {
    if (order?.status === 'delivered') {
      checkReview();
    }
  }, [order?.status]);

  // Re-fetch provider profile whenever selected_provider_id changes
  useEffect(() => {
    if (order?.selected_provider_id) {
      fetchSelectedProvider(order.selected_provider_id);
    } else {
      setSelectedProvider(null);
    }
  }, [order?.selected_provider_id]);

  // Subscribe to provider location updates (real-time) when in_transit
  useEffect(() => {
    const providerId = order?.selected_provider_id;
    if (!providerId || order?.status !== 'in_transit') return;

    // Fetch initial location
    supabase
      .from('provider_locations')
      .select('lat, lng')
      .eq('provider_id', providerId)
      .single()
      .then(({ data }) => {
        if (data) setProviderLocation({ lat: Number(data.lat), lng: Number(data.lng) });
      });

    const channel = supabase
      .channel(`provider-loc-${providerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'provider_locations',
          filter: `provider_id=eq.${providerId}`,
        },
        (payload) => {
          const row = payload.new as { lat: number; lng: number };
          if (row?.lat != null) setProviderLocation({ lat: Number(row.lat), lng: Number(row.lng) });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [order?.selected_provider_id, order?.status]);

  // Set customer marker from stored GPS coords; fall back to geocoding if absent
  useEffect(() => {
    if (!order) return;
    if (order.delivery_lat != null && order.delivery_lng != null) {
      setCustomerLocation({ lat: order.delivery_lat, lng: order.delivery_lng });
    } else if (order.delivery_address) {
      Location.geocodeAsync(order.delivery_address).then((results) => {
        if (results.length > 0) {
          setCustomerLocation({ lat: results[0].latitude, lng: results[0].longitude });
        }
      }).catch(() => {});
    }
  }, [order?.id]);

  // ── Data fetching ────────────────────────────────────────────────────────

  async function fetchAll() {
    await Promise.all([fetchOrder(), fetchItems(), fetchOrderAcceptances(), checkReview()]);
    setLoading(false);
  }

  async function checkReview() {
    const { data } = await supabase
      .from('reviews')
      .select('rating, comment')
      .eq('order_id', id)
      .maybeSingle();
    if (data) {
      setExistingRating(data.rating);
      setExistingComment(data.comment ?? null);
      setReviewRating(data.rating);
      setReviewComment(data.comment ?? '');
      setReviewDone(true);
    } else {
      // No review yet — ensure form is shown fresh
      setReviewDone(false);
      setExistingRating(null);
      setExistingComment(null);
    }
  }

  async function fetchOrder() {
    const { data } = await supabase
      .from('orders')
      .select('id, status, payment_method, delivery_address, delivery_lat, delivery_lng, total_amount, admin_fee, selected_provider_id, created_at, expires_at')
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

  async function fetchOrderAcceptances() {
    const { data: acceptanceRows } = await supabase
      .from('order_acceptances')
      .select('id, provider_id, accepted_at, provider:profiles(full_name, business_name, phone)')
      .eq('order_id', id)
      .is('withdrawn_at', null);
    console.log('[fetchOrderAcceptances] data:', acceptanceRows);

    if (!acceptanceRows || acceptanceRows.length === 0) {
      setAcceptances([]);
      return;
    }

    // Fetch order items with product_id for price calculation
    const { data: orderItemRows } = await supabase
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', id);

    const productIds = (orderItemRows ?? []).map((i) => i.product_id);
    const providerIds = acceptanceRows.map((a) => a.provider_id);

    // Fetch provider_products for all providers × all products in this order
    const { data: providerProductRows } = await supabase
      .from('provider_products')
      .select('provider_id, product_id, price')
      .in('provider_id', providerIds)
      .in('product_id', productIds);

    // Fetch reviews for all providers to compute avg rating
    const { data: reviewRows } = await supabase
      .from('reviews')
      .select('provider_id, rating')
      .in('provider_id', providerIds);

    // Fetch avg delivery time for all providers
    const { data: providerStatsRows } = await supabase
      .from('profiles')
      .select('id, avg_delivery_minutes')
      .in('id', providerIds);

    const deliveryStats: Record<string, number | null> = {};
    for (const p of providerStatsRows ?? []) {
      deliveryStats[p.id] = p.avg_delivery_minutes != null ? Number(p.avg_delivery_minutes) : null;
    }

    // Build review stats: reviewStats[provider_id] = { sum, count }
    const reviewStats: Record<string, { sum: number; count: number }> = {};
    for (const r of reviewRows ?? []) {
      if (!reviewStats[r.provider_id]) reviewStats[r.provider_id] = { sum: 0, count: 0 };
      reviewStats[r.provider_id].sum += r.rating;
      reviewStats[r.provider_id].count += 1;
    }

    // Build price lookup: providerPrices[provider_id][product_id] = price
    const providerPrices: Record<string, Record<string, number>> = {};
    for (const pp of providerProductRows ?? []) {
      if (!providerPrices[pp.provider_id]) providerPrices[pp.provider_id] = {};
      providerPrices[pp.provider_id][pp.product_id] = Number(pp.price);
    }

    const result: Acceptance[] = acceptanceRows.map((row) => {
      let provider_total = 0;
      for (const item of orderItemRows ?? []) {
        const price = providerPrices[row.provider_id]?.[item.product_id];
        if (price !== undefined) provider_total += price * item.quantity;
      }
      const stats = reviewStats[row.provider_id];
      return {
        id: row.id,
        provider_id: row.provider_id,
        accepted_at: row.accepted_at,
        provider: row.provider as Acceptance['provider'],
        provider_total,
        avgRating: stats ? stats.sum / stats.count : null,
        reviewCount: stats?.count ?? 0,
        avgDeliveryMinutes: deliveryStats[row.provider_id] ?? null,
      };
    });

    setAcceptances(result);
  }

  async function fetchSelectedProvider(providerId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, business_name, phone')
      .eq('id', providerId)
      .single();
    if (data) setSelectedProvider(data as ProviderProfile);
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

  function promptConfirmDelivery() {
    Alert.alert(
      'Confirm Delivery',
      'Confirm that you received your order?',
      [
        { text: 'Not Yet', style: 'cancel' },
        { text: 'Yes, Received!', onPress: confirmDelivery },
      ]
    );
  }

  async function confirmDelivery() {
    setConfirming(true);
    const { error } = await supabase
      .from('orders')
      .update({ status: 'delivered' })
      .eq('id', id);
    setConfirming(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setOrder((prev) => prev ? { ...prev, status: 'delivered' } : prev);
  }

  async function submitReview() {
    if (reviewRating === 0) {
      Alert.alert('Select a rating', 'Please tap a star to rate your delivery.');
      return;
    }
    if (!order?.selected_provider_id || !currentUserId) return;
    setSubmittingReview(true);

    const { error } = await supabase.from('reviews').insert({
      order_id: id,
      customer_id: currentUserId,
      provider_id: order.selected_provider_id,
      rating: reviewRating,
      comment: reviewComment.trim() || null,
    });

    setSubmittingReview(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    await checkReview();
  }

  function handleChat() {
    setUnreadCount(0);
    router.push({ pathname: '/(customer)/chat/[orderId]', params: { orderId: id } });
  }

  function handleCall() {
    const phone = selectedProvider?.phone;
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() =>
      Alert.alert('Error', 'Unable to open phone app.')
    );
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
  const canCancel = order.status === 'pending' || order.status === 'awaiting_dealer_selection';
  const shortId = order.id.slice(-8).toUpperCase();
  const placedAt = new Date(order.created_at).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const showAcceptances =
    (order.status === 'awaiting_dealer_selection' || acceptances.length > 0) &&
    !order.selected_provider_id &&
    order.status !== 'cancelled';
  const showSelectedProvider =
    order.selected_provider_id !== null &&
    order.status !== 'cancelled';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(customer)/orders')} style={styles.backButton} hitSlop={8}>
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

        {/* Confirm delivery — shown prominently when provider has marked as delivered */}
        {order.status === 'awaiting_confirmation' && (
          <View style={styles.confirmCard}>
            <Feather name="check-circle" size={32} color={PRIMARY} />
            <Text style={styles.confirmCardTitle}>Your order has been delivered!</Text>
            <Text style={styles.confirmCardSubtitle}>
              Please confirm that you received your order so the provider can be paid.
            </Text>
            <TouchableOpacity
              style={[styles.confirmBtn, confirming && { opacity: 0.6 }]}
              onPress={promptConfirmDelivery}
              disabled={confirming}
            >
              {confirming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmBtnText}>Confirm Delivery</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.reportBtn} onPress={() => Alert.alert('Report Issue', 'Please contact support.')}>
              <Text style={styles.reportBtnText}>Report an Issue</Text>
            </TouchableOpacity>
          </View>
        )}


        {/* Provider acceptances */}
        {showAcceptances && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Providers</Text>
              {acceptances.length > 0 && (
                <View>
                  <TouchableOpacity
                    style={styles.sortDropdownBtn}
                    onPress={() => setSortDropdownOpen((v) => !v)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.sortDropdownBtnText}>
                      {sortBy === 'price' ? 'Price' : 'Distance'}
                    </Text>
                    <Feather name={sortDropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color={PRIMARY} />
                  </TouchableOpacity>
                  {sortDropdownOpen && (
                    <View style={styles.sortDropdownMenu}>
                      {(['price', 'distance'] as const).map((key) => (
                        <TouchableOpacity
                          key={key}
                          style={[styles.sortDropdownItem, sortBy === key && styles.sortDropdownItemActive]}
                          onPress={() => { setSortBy(key); setSortDropdownOpen(false); }}
                        >
                          <Text style={[styles.sortDropdownItemText, sortBy === key && styles.sortDropdownItemTextActive]}>
                            {key === 'price' ? 'Price' : 'Distance'}
                          </Text>
                          {sortBy === key && <Feather name="check" size={13} color={PRIMARY} />}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
            {acceptances.length === 0 ? (
              <View style={styles.emptyProviders}>
                <ActivityIndicator size="small" color={PRIMARY} />
                <Text style={styles.emptyProvidersText}>Waiting for providers to accept...</Text>
              </View>
            ) : (
              [...acceptances]
                .sort((a, b) => {
                  if (sortBy === 'price') return a.provider_total - b.provider_total;
                  // distance: sort by avgRating descending as proxy (no distance data available)
                  if (a.avgRating == null && b.avgRating == null) return 0;
                  if (a.avgRating == null) return 1;
                  if (b.avgRating == null) return -1;
                  return b.avgRating - a.avgRating;
                })
                .map((acc) => (
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
              {order.status === 'in_transit' && (
                <TouchableOpacity
                  style={styles.providerActionBtn}
                  hitSlop={8}
                  onPress={() => setMapVisible(true)}
                >
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
                <Text style={styles.itemSubtotal}>₱{Number(item.subtotal).toLocaleString()}</Text>
              </View>
            ))}
            <View style={styles.itemTotalRow}>
              <Text style={styles.itemTotalLabel}>Total</Text>
              <Text style={styles.itemTotalValue}>₱{Number(order.total_amount).toLocaleString()}</Text>
            </View>
          </View>
        </View>

        {/* Review card — shown after delivery */}
        {order.status === 'delivered' && selectedProvider && (
          <View style={styles.reviewCard}>
            {reviewDone ? (
              <View style={styles.reviewDoneWrap}>
                <Feather name="check-circle" size={20} color={PRIMARY} />
                <Text style={styles.reviewDoneTitle}>Thank you for your review!</Text>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Feather key={s} name="star" size={16} color={s <= (existingRating ?? 0) ? '#FBBF24' : '#E5E7EB'} />
                  ))}
                </View>
                {existingComment ? (
                  <Text style={styles.reviewDoneComment}>"{existingComment}"</Text>
                ) : null}
              </View>
            ) : (
              <>
                <Text style={styles.reviewTitle}>Rate your delivery</Text>
                <View style={styles.reviewProviderRow}>
                  <View style={styles.reviewAvatar}>
                    <Feather name="user" size={14} color={PRIMARY} />
                  </View>
                  <Text style={styles.reviewProviderName}>{selectedProvider.full_name}</Text>
                </View>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity key={s} onPress={() => setReviewRating(s)} hitSlop={6}>
                      <Feather name="star" size={26} color={s <= reviewRating ? '#FBBF24' : '#E5E7EB'} />
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.reviewInput}
                  placeholder="Share your experience (optional)"
                  placeholderTextColor="#9CA3AF"
                  value={reviewComment}
                  onChangeText={setReviewComment}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.reviewSubmitBtn, submittingReview && { opacity: 0.6 }]}
                  onPress={submitReview}
                  disabled={submittingReview}
                >
                  {submittingReview
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.reviewSubmitText}>Submit Review</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.reviewSkipBtn} onPress={() => setReviewDone(true)}>
                  <Text style={styles.reviewSkipText}>Skip</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

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

      {/* Map modal */}
      <Modal visible={mapVisible} animationType="slide" onRequestClose={() => setMapVisible(false)}>
        <View style={[styles.modalScreen, { paddingTop: insets.top }]}>
          <LiveMap
            providerLocation={providerLocation}
            customerLocation={customerLocation}
            providerName={selectedProvider?.full_name}
            businessName={selectedProvider?.business_name ?? undefined}
            deliveryAddress={order?.delivery_address}
            onBack={() => setMapVisible(false)}
            onChat={() => { setMapVisible(false); handleChat(); }}
            onCall={selectedProvider?.phone ? handleCall : undefined}
          />
        </View>
      </Modal>
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
        {provider?.business_name && (
          <Text style={styles.providerName}>{provider.business_name}</Text>
        )}
        <View style={styles.ratingRow}>
          {acceptance.avgRating !== null ? (
            <>
              <Feather name="star" size={12} color="#FBBF24" />
              <Text style={styles.ratingText}>
                {acceptance.avgRating.toFixed(1)}
                <Text style={styles.ratingCount}> ({acceptance.reviewCount})</Text>
              </Text>
            </>
          ) : (
            <Text style={styles.ratingNew}>New provider</Text>
          )}
          {acceptance.avgDeliveryMinutes !== null && (
            <>
              <Text style={styles.ratingDot}>·</Text>
              <Feather name="clock" size={12} color="#9CA3AF" />
              <Text style={styles.ratingCount}>~{acceptance.avgDeliveryMinutes} mins</Text>
            </>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={[styles.selectBtn, selecting && styles.selectBtnDisabled]}
        onPress={onSelect}
        disabled={selecting}
      >
        {selecting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.selectBtnText}>
            {acceptance.provider_total > 0 ? `₱${acceptance.provider_total.toLocaleString()}` : 'Select'}
          </Text>
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

  // Confirm delivery card
  confirmCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
    gap: 10,
  },
  confirmCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  confirmCardSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  confirmBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    marginTop: 4,
  },
  confirmBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  reportBtn: { paddingVertical: 6 },
  reportBtnText: { fontSize: 13, color: '#9CA3AF' },

  // Section
  section: { marginBottom: 16, zIndex: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sortDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PRIMARY,
    backgroundColor: '#F0FDF4',
  },
  sortDropdownBtnText: { fontSize: 12, fontWeight: '600', color: PRIMARY },
  sortDropdownMenu: {
    position: 'absolute',
    top: 34,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 100,
    minWidth: 130,
    overflow: 'hidden',
  },
  sortDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  sortDropdownItemActive: { backgroundColor: '#F0FDF4' },
  sortDropdownItemText: { fontSize: 13, fontWeight: '500', color: '#374151' },
  sortDropdownItemTextActive: { color: PRIMARY, fontWeight: '600' },


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
  providerTotal: { fontSize: 13, fontWeight: '700', color: PRIMARY, marginTop: 3 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3, flexWrap: 'wrap' },
  ratingText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  ratingCount: { fontSize: 11, fontWeight: '400', color: '#9CA3AF' },
  ratingNew: { fontSize: 12, color: '#9CA3AF' },
  ratingDot: { fontSize: 12, color: '#D1D5DB' },
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

  // Chat button badge
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

  // Review card
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
    gap: 8,
  },
  reviewTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  reviewProviderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reviewAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewProviderName: { fontSize: 13, fontWeight: '600', color: '#374151' },
  starsRow: { flexDirection: 'row', gap: 6 },
  reviewInput: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#111827',
    minHeight: 56,
  },
  reviewSubmitBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 10,
    width: '100%',
    alignItems: 'center',
  },
  reviewSubmitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  reviewSkipBtn: { paddingVertical: 2 },
  reviewSkipText: { fontSize: 12, color: '#9CA3AF' },
  reviewDoneWrap: { alignItems: 'center', gap: 6 },
  reviewDoneTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  reviewDoneComment: { fontSize: 12, color: '#6B7280', textAlign: 'center', fontStyle: 'italic' },

  // Map modal
  modalScreen: { flex: 1, backgroundColor: '#000' },
});
