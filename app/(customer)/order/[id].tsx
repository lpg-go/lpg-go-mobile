import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ChatModal from '../../../components/ChatModal';
import OrderBidding from '../../../components/order/OrderBidding';
import OrderTracking from '../../../components/order/OrderTracking';
import StatusBadge from '../../../components/ui/StatusBadge';
import { colors, radii, spacing, typography } from '../../../lib/theme';
import { sendOrderNotification } from '../../../lib/notifications';
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
  is_express: boolean;
  express_fee: number;
  eta_minutes: number | null;
  eta_deadline: string | null;
  selected_provider_id: string | null;
  created_at: string;
  expires_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
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
    avatar_url: string | null;
  } | null;
};

type ProviderProfile = {
  id: string;
  full_name: string;
  business_name: string | null;
  phone: string;
  avatar_url: string | null;
  provider_type: 'dealer' | 'rider' | null;
};

type LatLng = { lat: number; lng: number };

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; color: string; bg: string }
> = {
  pending:                   { label: 'Select Provider',   color: colors.primary, bg: colors.primaryTint },
  awaiting_dealer_selection: { label: 'Finding Provider',  color: colors.primary, bg: colors.primaryTint },
  in_transit:                { label: 'On the Way',       color: colors.primary, bg: colors.primaryTint },
  awaiting_confirmation:     { label: 'Awaiting Confirmation', color: colors.primary, bg: colors.primaryTint },
  delivered:                 { label: 'Delivered',         color: '#FFFFFF', bg: colors.primary },
  cancelled:                 { label: 'Cancelled',         color: '#FFFFFF', bg: colors.danger },
};


// ─── Screen ──────────────────────────────────────────────────────────────────

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectingProvider, setSelectingProvider] = useState<string | null>(null); // provider_id being confirmed
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null); // highlighted card (pre-payment)
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<{ allow_cash_payment: boolean; allow_card_payment: boolean } | null>(null);
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
  const [reviewSpeed, setReviewSpeed] = useState<string | null>(null);
  const [existingSpeed, setExistingSpeed] = useState<string | null>(null);
  const [safetyCheck, setSafetyCheck] = useState<{ passed: boolean; notes: string | null; checked_at: string } | null>(null);

  // Bug 1 — Reset review state when order id changes
  useEffect(() => {
    setReviewRating(0);
    setReviewComment('');
    setReviewDone(false);
    setExistingRating(null);
    setExistingComment(null);
    setReviewSpeed(null);
    setExistingSpeed(null);
  }, [id]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatVisible, setChatVisible] = useState(false);

  // Location tracking
  const [providerLocation, setProviderLocation] = useState<LatLng | null>(null);
  const [customerLocation, setCustomerLocation] = useState<LatLng | null>(null);
  const [mapVisible, setMapVisible] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const orderRef = useRef<Order | null>(null);   // latest order, for detecting reverts in realtime
  const revertRedirectRef = useRef(false);        // guard: only redirect once on a provider-cancel revert

  // Keep orderRef in sync so the realtime handler can read the *previous* order.
  useEffect(() => { orderRef.current = order; }, [order]);

  // Provider cancelled and the order reverted to bidding — bounce the customer
  // back to the Find Provider resume screen instead of showing inline bidding.
  async function handleProviderRevert() {
    const { data } = await supabase
      .from('order_items')
      .select('product_id')
      .eq('order_id', id)
      .limit(1);
    const firstProductId = data?.[0]?.product_id ?? null;

    if (!firstProductId) {
      // Can't determine the product to resume — stay here (inline bidding fallback).
      revertRedirectRef.current = false;
      return;
    }

    Alert.alert(
      'Provider Unavailable',
      'Your provider became unavailable. Please choose another.',
      [{
        text: 'OK',
        onPress: () => router.replace({
          pathname: '/(customer)/find-store/[productId]',
          params: { productId: firstProductId, resumeOrderId: id },
        }),
      }],
    );
  }

  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel(`order-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        (payload) => {
          console.log('[Realtime] orders change:', payload);
          const newRow = payload.new as Partial<Order> | undefined;
          if (newRow) {
            // Revert: previously had a provider, now back to bidding with none.
            const prevOrder = orderRef.current;
            const revertedToBidding =
              newRow.status === 'awaiting_dealer_selection' &&
              newRow.selected_provider_id == null &&
              prevOrder?.selected_provider_id != null;

            if (revertedToBidding && !revertRedirectRef.current) {
              revertRedirectRef.current = true;
              handleProviderRevert();
            }

            setOrder((prev) => prev ? { ...prev, ...newRow } : null);
            if (newRow.status === 'cancelled') {
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
            }
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

  // Fetch payment settings once on mount; default selected method to cash if allowed
  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('allow_cash_payment, allow_card_payment')
      .single()
      .then(({ data }) => {
        if (data) {
          setPaymentSettings(data);
          setPaymentMethod(data.allow_cash_payment ? 'cash' : data.allow_card_payment ? 'card' : null);
        }
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

  // Clear the highlighted (pre-payment) provider when bidding ends or the
  // highlighted provider is no longer available — avoids a stale highlight /
  // enabled "Select Provider" button pointing at a provider who's gone.
  useEffect(() => {
    if (!selectedProviderId) return;
    const leftBidding =
      order?.status !== 'awaiting_dealer_selection' || order?.selected_provider_id != null;
    const providerGone = !acceptances.some((a) => a.provider_id === selectedProviderId);
    if (leftBidding || providerGone) {
      setSelectedProviderId(null);
    }
  }, [order?.status, order?.selected_provider_id, acceptances, selectedProviderId]);

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
    await Promise.all([fetchOrder(), fetchItems(), fetchOrderAcceptances(), checkReview(), fetchSafetyCheck()]);
    setLoading(false);
  }

  async function fetchSafetyCheck() {
    const { data } = await supabase
      .from('delivery_safety_checks')
      .select('passed, notes, checked_at')
      .eq('order_id', id)
      .maybeSingle();
    setSafetyCheck(data ?? null);
  }

  async function checkReview() {
    const { data } = await supabase
      .from('reviews')
      .select('rating, comment, delivery_speed')
      .eq('order_id', id)
      .maybeSingle();
    if (data) {
      setExistingRating(data.rating);
      setExistingComment(data.comment ?? null);
      setExistingSpeed(data.delivery_speed ?? null);
      setReviewRating(data.rating);
      setReviewComment(data.comment ?? '');
      setReviewSpeed(data.delivery_speed ?? null);
      setReviewDone(true);
    } else {
      // No review yet — ensure form is shown fresh
      setReviewDone(false);
      setExistingRating(null);
      setExistingComment(null);
      setExistingSpeed(null);
    }
  }

  async function fetchOrder() {
    const { data } = await supabase
      .from('orders')
      .select('id, status, payment_method, delivery_address, delivery_lat, delivery_lng, total_amount, admin_fee, is_express, express_fee, eta_minutes, eta_deadline, selected_provider_id, created_at, expires_at, cancelled_by, cancel_reason')
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
      .select('id, provider_id, accepted_at, provider:profiles(full_name, business_name, phone, avatar_url)')
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
      .select('id, full_name, business_name, phone, avatar_url, provider_type')
      .eq('id', providerId)
      .single();
    if (data) setSelectedProvider(data as ProviderProfile);
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function confirmSelection() {
    if (!pendingProviderId || !paymentMethod) return;
    setSelectingProvider(pendingProviderId);

    // Provider selection is fully server-side: the RPC records payment_method +
    // is_express and derives express_fee from platform settings, so there is no
    // pre-write to the order (which previously caused a false revert alert).
    // This screen has no express toggle — preserve the order's existing flag.
    const { error } = await supabase.rpc('select_provider_for_order', {
      p_order_id: id,
      p_provider_id: pendingProviderId,
      p_payment_method: paymentMethod,
      p_is_express: order?.is_express ?? false,
    });

    setSelectingProvider(null);
    if (!error) {
      sendOrderNotification(id, 'dealer_selected');
      sendOrderNotification(id, 'in_transit');
      setPendingProviderId(null);
    }

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
    const { error } = await supabase.rpc('cancel_order', { p_order_id: id });
    setCancelling(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    sendOrderNotification(id, 'order_cancelled');
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
    const { error } = await supabase.rpc('confirm_delivery', { p_order_id: id });
    setConfirming(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    sendOrderNotification(id, 'delivery_confirmed');
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
      delivery_speed: reviewSpeed || null,
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
    setChatVisible(true);
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
        <ActivityIndicator size="large" color={colors.primary} />
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
    <View style={styles.screen}>
      {/* Dark detail header with back button */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={20} color={colors.headerText} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>Order #{shortId}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{statusCfg.label}</Text>
        </View>
        {order.is_express ? <StatusBadge label="Express" tone="express" /> : null}
      </View>

      <OrderTracking
        order={order}
        items={items}
        selectedProvider={selectedProvider}
        statusCfg={statusCfg}
        shortId={shortId}
        placedAt={placedAt}
        providerLocation={providerLocation}
        customerLocation={customerLocation}
        mapVisible={mapVisible}
        unreadCount={unreadCount}
        reviewDone={reviewDone}
        existingRating={existingRating}
        existingComment={existingComment}
        safetyCheck={safetyCheck}
        reviewRating={reviewRating}
        reviewComment={reviewComment}
        reviewSpeed={reviewSpeed}
        existingSpeed={existingSpeed}
        setReviewSpeed={setReviewSpeed}
        submittingReview={submittingReview}
        confirming={confirming}
        onOpenMap={() => setMapVisible(true)}
        onCloseMap={() => setMapVisible(false)}
        onChat={handleChat}
        onCall={handleCall}
        onConfirmDelivery={promptConfirmDelivery}
        onSetReviewRating={setReviewRating}
        onSetReviewComment={setReviewComment}
        onSubmitReview={submitReview}
        onPlaceNewOrder={() => router.replace('/(customer)/')}
        cancelSlot={canCancel && (
          <TouchableOpacity
            style={[styles.cancelButton, cancelling && styles.cancelButtonDisabled]}
            onPress={confirmCancelOrder}
            disabled={cancelling}
          >
            {cancelling ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Text style={styles.cancelButtonText}>Cancel Order</Text>
            )}
          </TouchableOpacity>
        )}
      >
        <OrderBidding
          showAcceptances={showAcceptances}
          acceptances={acceptances}
          sortBy={sortBy}
          sortDropdownOpen={sortDropdownOpen}
          selectedProviderId={selectedProviderId}
          pendingProviderId={pendingProviderId}
          paymentMethod={paymentMethod}
          paymentSettings={paymentSettings}
          selectingProvider={selectingProvider}
          onToggleSortDropdown={() => setSortDropdownOpen((v) => !v)}
          onSetSortBy={(key) => { setSortBy(key); setSortDropdownOpen(false); }}
          onSelectCard={(providerId) => setSelectedProviderId(providerId)}
          onOpenPayment={() => selectedProviderId && setPendingProviderId(selectedProviderId)}
          onSetPaymentMethod={setPaymentMethod}
          onConfirmSelection={confirmSelection}
          onClosePayment={() => setPendingProviderId(null)}
        />
      </OrderTracking>

      <ChatModal
        visible={chatVisible}
        onClose={() => { setChatVisible(false); setUnreadCount(0); }}
        orderId={id}
        currentUserId={currentUserId ?? ''}
        otherUserName={selectedProvider?.full_name ?? 'Provider'}
        role="customer"
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 15, color: colors.textSecondary },

  // Dark detail header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.headerSurface,
    borderWidth: 1,
    borderColor: colors.headerSurfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.headerText },
  headerSubtitle: { ...typography.caption, color: colors.headerSubtext, marginTop: 2 },


  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.screenH, paddingTop: 16 },

  // Status card
  statusCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginBottom: 12,
  },
  statusBadgeText: { fontSize: 16, fontWeight: '700' },
  orderId: { fontSize: 13, fontWeight: '400', color: colors.textSecondary, marginBottom: 2 },
  placedAt: { fontSize: 12, color: colors.textMuted, marginBottom: 10 },
  addressRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
  },
  addressText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, flex: 1, textAlign: 'center' },

  // System-expired card
  expiredCard: {
    backgroundColor: colors.dangerTint,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  expiredTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.danger,
    marginTop: 4,
  },
  expiredSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  newOrderBtn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  newOrderBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },

  // Confirm delivery card
  confirmCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primaryTintStrong,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
    gap: 10,
  },
  confirmCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  confirmCardSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  confirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    marginTop: 4,
  },
  confirmBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  reportBtn: { paddingVertical: 6 },
  reportBtnText: { fontSize: 13, color: colors.textMuted },

  // Section
  section: { marginBottom: 16, zIndex: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 },
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
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  sortDropdownBtnText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  sortDropdownMenu: {
    position: 'absolute',
    top: 34,
    right: 0,
    backgroundColor: colors.card,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
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
  sortDropdownItemActive: { backgroundColor: colors.primaryTint },
  sortDropdownItemText: { fontSize: 13, fontWeight: '500', color: colors.grey700 },
  sortDropdownItemTextActive: { color: colors.primary, fontWeight: '600' },


  // Provider acceptances
  emptyProviders: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyProvidersText: { fontSize: 13, color: colors.textSecondary },
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedProviderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.primaryTintStrong,
  },
  providerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTintStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  avatarImage: { width: 40, height: 40, borderRadius: 20 },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 14, fontWeight: '600', color: colors.text },
  providerBusiness: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  providerTotal: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: 3 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3, flexWrap: 'wrap' },
  ratingText: { fontSize: 12, fontWeight: '600', color: colors.grey700 },
  ratingCount: { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  ratingNew: { fontSize: 12, color: colors.textMuted },
  ratingDot: { fontSize: 12, color: colors.grey300 },
  // Message banner
  msgBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
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
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  unreadBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },

  providerActions: { flexDirection: 'row', gap: 8 },
  providerActionBtn: {
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  providerActionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  selectBtn: {
    backgroundColor: colors.primary,
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
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.grey100 },
  itemName: { flex: 1, fontSize: 13, color: colors.grey700 },
  itemQty: { fontSize: 13, color: colors.textMuted, marginHorizontal: 12 },
  itemSubtotal: { fontSize: 13, fontWeight: '600', color: colors.text, minWidth: 64, textAlign: 'right' },
  itemTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.grey50,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  itemTotalLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  itemTotalValue: { fontSize: 14, fontWeight: '800', color: colors.primary },

  // Cancel
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelButtonDisabled: { opacity: 0.5 },
  cancelButtonText: { fontSize: 14, fontWeight: '600', color: colors.danger },

  // Review card
  reviewCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
    gap: 8,
  },
  reviewTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  reviewProviderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reviewAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primaryTintStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewProviderName: { fontSize: 13, fontWeight: '600', color: colors.grey700 },
  starsRow: { flexDirection: 'row', gap: 6 },
  reviewInput: {
    width: '100%',
    backgroundColor: colors.grey50,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.text,
    minHeight: 56,
  },
  reviewSubmitBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: 10,
    width: '100%',
    alignItems: 'center',
  },
  reviewSubmitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  reviewSkipBtn: { paddingVertical: 2 },
  reviewSkipText: { fontSize: 12, color: colors.textMuted },
  reviewDoneWrap: { alignItems: 'center', gap: 6 },
  reviewDoneTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  reviewDoneComment: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', fontStyle: 'italic' },

  // Map modal
  modalScreen: { flex: 1, backgroundColor: '#000' },

  // Payment modal
  paymentModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  paymentModalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.screenH,
    paddingTop: 18,
  },
  paymentModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  paymentModalTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  paymentOptions: { gap: 10, marginBottom: 16 },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  paymentOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.grey300,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  paymentLabel: { fontSize: 14, fontWeight: '500', color: colors.grey700 },
  paymentLabelSelected: { color: colors.primary, fontWeight: '600' },
  confirmOrderBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  confirmOrderBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  paymentCancelBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  paymentCancelBtnText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
});
