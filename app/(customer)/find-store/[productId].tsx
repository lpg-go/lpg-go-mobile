import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import OrderBidding from '../../../components/order/OrderBidding';
import PrimaryButton from '../../../components/ui/PrimaryButton';
import DetailHeader from '../../../components/ui/DetailHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import { colors, radii, spacing, typography, shadows } from '../../../lib/theme';
import { sendOrderNotification } from '../../../lib/notifications';
import supabase from '../../../lib/supabase';

type PlatformSettings = {
  order_expiry_minutes: number;
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

const H_PADDING = 20;

export default function FindStoreScreen() {
  const insets = useSafeAreaInsets();

  const {
    productId,
    productName,
    brandName,
    sizeKg,
    unitPrice,
    maxPrice,
    providerProductId,
    resumeOrderId,
  } = useLocalSearchParams<{
    productId: string;
    productName: string;
    brandName: string;
    sizeKg: string;
    unitPrice: string;
    maxPrice: string;
    providerProductId: string;
    resumeOrderId?: string;
  }>();

  const unitPriceNum = Number(unitPrice);
  const maxPriceNum = Number(maxPrice);

  // When resuming an existing order, product name/price come from the DB
  // (the navigation params productName/unitPrice may be absent).
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [resumeUnitPrice, setResumeUnitPrice] = useState<number | null>(null);

  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');

  const [quantity, setQuantity] = useState(1);

  const [settings, setSettings] = useState<PlatformSettings | null>(null);

  const [placing, setPlacing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');

  const [phase, setPhase] = useState<'form' | 'bidding'>('form');
  const [orderId, setOrderId] = useState<string | null>(null);

  // Bidding phase — provider acceptances
  const [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  const [selectingProvider, setSelectingProvider] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'price' | 'distance'>('price');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<{ allow_cash_payment: boolean; allow_card_payment: boolean } | null>(null);
  const [maxActiveOrders, setMaxActiveOrders] = useState(0); // 0 = unlimited

  // Express Delivery — admin-configured offer; toggle defaults OFF per order.
  const [expressEnabled, setExpressEnabled] = useState(false);
  const [expressFee, setExpressFee] = useState(0);
  const [isExpress, setIsExpress] = useState(false);
  const [activeOrderCount, setActiveOrderCount] = useState(0);

  const [pickerVisible, setPickerVisible] = useState(false);

  const mapRef = useRef<MapView>(null);
  // Snapshot of address/coords when the picker opens, so Cancel can restore.
  const snapshotRef = useRef<{ address: string; lat: number | null; lng: number | null } | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset all bidding-phase state to a clean form. Address is intentionally left
  // untouched so it persists across products.
  const resetBiddingState = useCallback(() => {
    setPhase('form');
    setOrderId(null);
    setAcceptances([]);
    setSelectedProviderId(null);
    setPendingProviderId(null);
    setSelectingProvider(null);
    setPlacing(false);
    setIsExpress(false);
    setError('');
    setQuantity(1);
  }, []);

  useEffect(() => {
    autoGetLocation();
  }, []);

  // Resume an existing order's bidding: jump straight to bidding phase and
  // load the order so the read-only product + address display is populated.
  // Realtime + polling (keyed on phase/orderId) then drive the providers list.
  useEffect(() => {
    if (!resumeOrderId) return;
    setOrderId(resumeOrderId);
    setPhase('bidding');
    loadResumeOrder(resumeOrderId);
  }, [resumeOrderId]);

  async function loadResumeOrder(oid: string) {
    const { data: order } = await supabase
      .from('orders')
      .select('delivery_address, status')
      .eq('id', oid)
      .single();

    // A sticky/stale resumeOrderId could point at an already-finished order.
    // Don't reopen it — reset to a clean form instead.
    if (!order || order.status === 'delivered' || order.status === 'cancelled') {
      resetBiddingState();
      return;
    }

    setAddress(order.delivery_address ?? '');

    // Single-product order — load its item for the product/quantity display
    const { data: item } = await supabase
      .from('order_items')
      .select('quantity, unit_price, product:products(name)')
      .eq('order_id', oid)
      .limit(1)
      .single();
    if (item) {
      setQuantity(item.quantity);
      setResumeUnitPrice(Number(item.unit_price));
      setResumeName((item.product as { name: string } | null)?.name ?? 'Product');
    }
  }

  useFocusEffect(
    useCallback(() => {
      fetchSettings();
      fetchActiveOrderCount();
      // The route component is cached by the Tabs navigator and reused across
      // visits with the same productId, so state persists unless we clear it.
      // Reset on every focus so revisiting a product after a completed order
      // starts clean. Skip when resuming an existing order's bidding.
      if (!resumeOrderId) {
        resetBiddingState();
      }
    }, [resumeOrderId, resetBiddingState])
  );

  // Count the customer's current active orders (for the at-limit check).
  async function fetchActiveOrderCount() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setActiveOrderCount(0); return; }

    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', user.id)
      .in('status', ['awaiting_dealer_selection', 'in_transit', 'awaiting_confirmation']);

    setActiveOrderCount(count ?? 0);
  }

  // Bidding phase — realtime subscription on the orders row + initial fetch
  useEffect(() => {
    if (phase !== 'bidding' || !orderId) return;

    fetchOrderAcceptances();

    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          console.log('[find-store bidding] orders change:', payload);
          fetchOrderAcceptances();
        }
      )
      .subscribe((status) => {
        console.log('[find-store bidding] channel status:', status);
      });

    return () => { supabase.removeChannel(channel); };
  }, [phase, orderId]);

  // Bidding phase — poll order_acceptances every 5s
  useEffect(() => {
    if (phase !== 'bidding' || !orderId) {
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
  }, [phase, orderId]);

  // Fetch payment settings once on mount; default selected method to cash if allowed
  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('allow_cash_payment, allow_card_payment, max_active_orders_per_customer, express_enabled, express_delivery_fee')
      .single()
      .then(({ data }) => {
        if (data) {
          setPaymentSettings(data);
          setPaymentMethod(data.allow_cash_payment ? 'cash' : data.allow_card_payment ? 'card' : null);
          setMaxActiveOrders(Number(data.max_active_orders_per_customer ?? 0));
          setExpressEnabled(Boolean(data.express_enabled));
          setExpressFee(Number(data.express_delivery_fee ?? 0));
        }
      });
  }, []);

  async function fetchSettings() {
    const { data } = await supabase
      .from('platform_settings')
      .select('order_expiry_minutes')
      .single();

    if (data) {
      setSettings(data);
    }
  }

  async function fetchOrderAcceptances() {
    if (!orderId) return;

    const { data: acceptanceRows } = await supabase
      .from('order_acceptances')
      .select('id, provider_id, accepted_at, provider:profiles(full_name, business_name, phone, avatar_url)')
      .eq('order_id', orderId)
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
      .eq('order_id', orderId);

    const productIds = (orderItemRows ?? []).map((i) => i.product_id);
    const providerIds = acceptanceRows.map((a) => a.provider_id);

    // Fetch provider_products for all providers × all products in this order
    const { data: providerProductRows } = await supabase
      .from('provider_products')
      .select('provider_id, product_id, price')
      .in('provider_id', providerIds)
      .in('product_id', productIds)
      // Defense in depth: only live, priced listings are biddable so a
      // 0-price/unavailable row can never reach checkout (mirrors the DB
      // constraint chk_available_requires_price and the RPC guard).
      .eq('is_available', true)
      .gt('price', 0);

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

  async function autoGetLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setLocationError('Location off — type your address or tap Use current location.');
      return;
    }

    setLocationLoading(true);
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = position.coords;
      applyLocation(latitude, longitude);
    } catch {
      // Silent fail on auto-load
    } finally {
      setLocationLoading(false);
    }
  }

  async function handleUseLocation() {
    setLocationError('');
    setLocationLoading(true);

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setLocationError('Location permission denied. Please enter address manually.');
      setLocationLoading(false);
      return;
    }

    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = position.coords;
      await applyLocation(latitude, longitude);
      mapRef.current?.animateToRegion(
        { latitude, longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
        400
      );
    } catch {
      setLocationError('Could not get location. Please try again or enter address manually.');
    } finally {
      setLocationLoading(false);
    }
  }

  async function applyLocation(latitude: number, longitude: number) {
    setLat(latitude);
    setLng(longitude);

    const [result] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (result) {
      const parts = [
        result.streetNumber,
        result.street,
        result.district,
        result.city,
        result.region,
      ].filter(Boolean);
      setAddress(parts.join(', '));
    }
  }

  async function handlePinDrag(coordinate: { latitude: number; longitude: number }) {
    const { latitude, longitude } = coordinate;
    setLat(latitude);
    setLng(longitude);

    try {
      const [result] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (result) {
        const parts = [
          result.streetNumber,
          result.street,
          result.district,
          result.city,
          result.region,
        ].filter(Boolean);
        setAddress(parts.join(', '));
      }
    } catch {
      // Reverse geocoding failed — keep existing address text
    }
  }

  function openPicker() {
    // Remember current values so a Cancel can revert any live pin edits.
    snapshotRef.current = { address, lat, lng };
    setPickerVisible(true);
  }

  function cancelPicker() {
    const snap = snapshotRef.current;
    if (snap) {
      setAddress(snap.address);
      setLat(snap.lat);
      setLng(snap.lng);
    }
    setPickerVisible(false);
  }

  function confirmPicker() {
    // Pin edits already applied live via handlePinDrag/handleUseLocation.
    setPickerVisible(false);
  }

  async function confirmSelection() {
    if (!pendingProviderId || !paymentMethod || !orderId) return;
    setSelectingProvider(pendingProviderId);

    // Provider selection is fully server-side: the RPC records payment_method +
    // is_express and derives express_fee from platform settings, so there is no
    // pre-write to the order (which previously caused a false revert alert).
    const { error } = await supabase.rpc('select_provider_for_order', {
      p_order_id: orderId,
      p_provider_id: pendingProviderId,
      p_payment_method: paymentMethod,
      p_is_express: isExpress,
    });

    setSelectingProvider(null);
    if (!error) {
      sendOrderNotification(orderId, 'dealer_selected');
      sendOrderNotification(orderId, 'in_transit');
      // Nudge the backend to compute the express ETA once the rider has had a
      // moment to push a first location fix. Fire-and-forget, best-effort.
      if (isExpress) {
        setTimeout(() => void supabase.rpc('set_order_eta', { p_order_id: orderId }), 5000);
      }
      setPendingProviderId(null);
      // Stop polling before leaving the bidding screen
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      router.replace({ pathname: '/(customer)/order/[id]', params: { id: orderId } });
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
    if (!orderId) return;
    setCancelling(true);
    const { error } = await supabase.rpc('cancel_order', { p_order_id: orderId });
    setCancelling(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    sendOrderNotification(orderId, 'order_cancelled');
    // Stop polling before leaving the bidding screen
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    router.replace('/(customer)/orders');
  }

  async function handleFindStore() {
    setError('');

    if (!address.trim()) {
      setError('Please enter a delivery address.');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Not authenticated.');
      return;
    }

    // Safety net — the Find Provider button is disabled at the limit, but
    // re-check with a fresh count in case state was stale (0 = unlimited).
    if (maxActiveOrders > 0) {
      const { count: activeCount } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', user.id)
        .in('status', ['awaiting_dealer_selection', 'in_transit', 'awaiting_confirmation']);

      setActiveOrderCount(activeCount ?? 0);
      if ((activeCount ?? 0) >= maxActiveOrders) {
        return;
      }
    }

    setPlacing(true);

    // Order creation is fully server-side now (place_order RPC). The server derives
    // unit_price/admin_fee/total/expires_at and the cheapest provider, inserts the
    // order + item atomically in 'awaiting_dealer_selection', and enforces the
    // active-order cap — so the client can no longer set any money/state columns.
    // payment_method is chosen later at provider selection (confirmSelection), so we
    // let the RPC default to 'cash' here; it's overwritten at selection like before.
    const { data: newOrderId, error: orderError } = await supabase.rpc('place_order', {
      p_product_id: productId,
      p_quantity: quantity,
      p_delivery_address: address.trim(),
      p_delivery_lat: lat,
      p_delivery_lng: lng,
      p_is_express: isExpress,
    });

    if (orderError || !newOrderId) {
      setPlacing(false);
      // The RPC raises clear, user-readable messages (e.g. 'No available providers
      // for this product', 'Too many active orders').
      setError(orderError?.message ?? 'Could not place order. Please try again.');
      return;
    }

    console.log('[find-store] order placed, sending new_order notification for', newOrderId);
    sendOrderNotification(newOrderId, 'new_order');
    setPlacing(false);
    setOrderId(newOrderId);
    setPhase('bidding');
  }

  // Product name/price fall back to DB-loaded values when resuming an order.
  const displayName = productName || resumeName || 'Product';
  const displayUnitPrice = resumeUnitPrice ?? unitPriceNum;
  const totalAmount = quantity * (displayUnitPrice || 0);
  const canFindStore = address.trim().length > 0;
  const atLimit = maxActiveOrders > 0 && activeOrderCount >= maxActiveOrders;
  // Lock the form inputs in bidding phase, or when the customer is at their limit.
  const inputsDisabled = phase === 'bidding' || atLimit;

  // Header + summary display helpers (visual only).
  const orderShort = orderId ? orderId.slice(0, 8) : '';
  const summaryProduct =
    [brandName || displayName, sizeKg ? `${sizeKg}kg` : null].filter(Boolean).join(' ') +
    ` ×${quantity}`;
  const selectedAcc = acceptances.find((a) => a.provider_id === selectedProviderId);
  const selectedName =
    selectedAcc?.provider?.business_name || selectedAcc?.provider?.full_name || 'provider';
  const selectedTotal = selectedAcc?.provider_total ?? 0;

  return (
    <View style={styles.screen}>
      <DetailHeader
        title={brandName || displayName}
        subtitle={phase === 'bidding' ? `Order #${orderShort}` : 'Set delivery details'}
        onBack={() => router.back()}
        right={phase === 'bidding' && isExpress ? <StatusBadge label="Express" tone="express" /> : undefined}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 160 + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {phase === 'form' ? (
          <>
            {/* Delivery address */}
            <View style={styles.section}>
              <Text style={styles.label}>Delivery Address</Text>
              <View style={styles.addressCard}>
                <Feather name="map-pin" size={18} color={colors.primary} style={styles.addressIcon} />
                <TextInput
                  style={styles.addressInput}
                  placeholder={locationLoading ? 'Getting your location…' : 'Enter your full delivery address'}
                  placeholderTextColor={colors.textMuted}
                  value={address}
                  editable={!inputsDisabled}
                  onChangeText={(text) => {
                    setAddress(text);
                    // Clear stored coords when user edits manually
                    if (lat !== null) { setLat(null); setLng(null); }
                  }}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                {!inputsDisabled && (
                  <TouchableOpacity
                    style={styles.addressPinButton}
                    onPress={openPicker}
                    hitSlop={8}
                  >
                    <Feather name="map-pin" size={18} color={colors.headerText} />
                  </TouchableOpacity>
                )}
              </View>
              {locationError ? <Text style={styles.fieldError}>{locationError}</Text> : null}
            </View>

            {/* Product summary + quantity */}
            <View style={styles.section}>
              <View style={styles.card}>
                <View style={styles.productInfo}>
                  <Text style={styles.productName} numberOfLines={1}>{displayName}</Text>
                  <Text style={styles.productPrice}>Est. ₱{totalAmount.toLocaleString()}</Text>
                </View>
                <View style={[styles.quantityRow, inputsDisabled && styles.quantityRowDisabled]}>
                  <TouchableOpacity
                    style={[styles.qtyButtonMinus, quantity <= 1 && styles.qtyButtonDisabled]}
                    onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1 || inputsDisabled}
                    hitSlop={8}
                  >
                    <Feather name="minus" size={18} color={quantity <= 1 ? colors.textMuted : colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.qtyValue}>{quantity}</Text>
                  <TouchableOpacity
                    style={styles.qtyButtonPlus}
                    onPress={() => setQuantity((q) => q + 1)}
                    disabled={inputsDisabled}
                    hitSlop={8}
                  >
                    <Feather name="plus" size={18} color={colors.headerText} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.estimateNote}>
                Final price depends on the provider you choose.
              </Text>
            </View>

            {/* Express Delivery — only when the admin has enabled the offer */}
            {expressEnabled && (
              <View style={styles.section}>
                <View style={styles.expressCard}>
                  <View style={styles.expressIconCircle}>
                    <Feather name="zap" size={18} color={colors.amberDark} />
                  </View>
                  <View style={styles.expressTextWrap}>
                    <Text style={styles.expressLabel}>Express delivery</Text>
                    <Text style={styles.expressSub}>
                      Priority rider · +₱{expressFee.toLocaleString()}
                    </Text>
                  </View>
                  <Switch
                    value={isExpress}
                    onValueChange={setIsExpress}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
              </View>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : (
          /* Bidding — collapsed read-only summary of the placed order */
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Feather name="map-pin" size={15} color={colors.textMuted} style={styles.summaryIcon} />
              <Text style={styles.summaryText} numberOfLines={1}>{address || 'No address'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Feather name="package" size={15} color={colors.textMuted} style={styles.summaryIcon} />
              <Text style={styles.summaryText} numberOfLines={1}>{summaryProduct}</Text>
            </View>
            {isExpress && (
              <View style={styles.summaryRow}>
                <Feather name="zap" size={15} color={colors.amberDark} style={styles.summaryIcon} />
                <Text style={[styles.summaryText, { color: colors.amberText }]}>Express delivery</Text>
              </View>
            )}
          </View>
        )}

        {/* Bidding content — provider acceptances (shared component) */}
        <OrderBidding
          showAcceptances={phase === 'bidding'}
          hideSelectButton
          acceptances={acceptances}
          sortBy={sortBy}
          sortDropdownOpen={sortDropdownOpen}
          selectedProviderId={selectedProviderId}
          pendingProviderId={pendingProviderId}
          paymentMethod={paymentMethod}
          paymentSettings={paymentSettings}
          selectingProvider={selectingProvider}
          isExpress={isExpress}
          onToggleSortDropdown={() => setSortDropdownOpen((v) => !v)}
          onSetSortBy={(key) => { setSortBy(key); setSortDropdownOpen(false); }}
          onSelectCard={(providerId) => setSelectedProviderId(providerId)}
          onOpenPayment={() => selectedProviderId && setPendingProviderId(selectedProviderId)}
          onSetPaymentMethod={setPaymentMethod}
          onConfirmSelection={confirmSelection}
          onClosePayment={() => { setPendingProviderId(null); setIsExpress(false); }}
        />
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {phase === 'form' ? (
          <>
            {atLimit && (
              <View style={styles.limitBanner}>
                <Feather name="info" size={18} color={colors.amberDark} style={styles.limitBannerIcon} />
                <Text style={styles.limitBannerText}>
                  Complete or cancel an order to place a new one.
                </Text>
              </View>
            )}
            <PrimaryButton
              label="Find providers"
              onPress={handleFindStore}
              loading={placing}
              disabled={!canFindStore || atLimit}
            />
          </>
        ) : (
          <>
            <PrimaryButton
              label={
                selectedProviderId
                  ? `Select ${selectedName} · ₱${selectedTotal.toLocaleString()}`
                  : 'Select provider'
              }
              onPress={() => selectedProviderId && setPendingProviderId(selectedProviderId)}
              disabled={!selectedProviderId}
            />
            <View style={styles.buttonGap} />
            <PrimaryButton
              label="Cancel order"
              variant="danger"
              onPress={confirmCancelOrder}
              loading={cancelling}
            />
          </>
        )}
      </View>

      {/* Full-screen map picker */}
      <Modal
        visible={pickerVisible}
        animationType="slide"
        onRequestClose={cancelPicker}
      >
        <View style={styles.pickerScreen}>
          <MapView
            ref={mapRef}
            style={styles.pickerMap}
            initialRegion={{
              latitude: lat ?? DEFAULT_REGION.latitude,
              longitude: lng ?? DEFAULT_REGION.longitude,
              latitudeDelta: lat !== null ? 0.005 : DEFAULT_REGION.latitudeDelta,
              longitudeDelta: lng !== null ? 0.005 : DEFAULT_REGION.longitudeDelta,
            }}
            onPress={(e) => handlePinDrag(e.nativeEvent.coordinate)}
            showsUserLocation
            showsMyLocationButton={false}
          >
            {lat !== null && lng !== null && (
              <Marker
                coordinate={{ latitude: lat, longitude: lng }}
                draggable
                onDragEnd={(e) => handlePinDrag(e.nativeEvent.coordinate)}
              >
                <View style={styles.deliveryPin}>
                  <Feather name="map-pin" size={18} color="#fff" />
                </View>
              </Marker>
            )}
          </MapView>

          {/* Top bar: close + search placeholder */}
          <View style={[styles.pickerTopBar, { top: insets.top + 12 }]}>
            <TouchableOpacity
              style={styles.pickerCloseButton}
              onPress={cancelPicker}
              hitSlop={8}
            >
              <Feather name="x" size={22} color={colors.text} />
            </TouchableOpacity>
            {/* TODO: wire location search — visual placeholder only for now */}
            <View style={styles.pickerSearchBar}>
              <Feather name="search" size={16} color={colors.textMuted} />
              <Text style={styles.pickerSearchText}>Search location</Text>
            </View>
          </View>

          {/* Bottom sheet */}
          <View style={[styles.pickerBottomBar, { paddingBottom: insets.bottom + 16 }]}>
            {/* Floating current-location button, anchored above the sheet */}
            <TouchableOpacity
              style={styles.pickerLocateBtn}
              onPress={handleUseLocation}
              disabled={locationLoading}
              activeOpacity={0.8}
            >
              {locationLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="navigation" size={20} color={colors.primary} />
              )}
            </TouchableOpacity>

            <Text style={styles.pickerLabel}>Delivery location</Text>
            <View style={styles.pickerAddressRow}>
              <Feather name="map-pin" size={18} color={colors.primary} style={styles.pickerAddressIcon} />
              <Text style={styles.pickerAddressText} numberOfLines={2}>
                {address || 'Move the map to set your location'}
              </Text>
            </View>
            <PrimaryButton
              label="Confirm location"
              onPress={confirmPicker}
              disabled={lat === null}
            />
          </View>
        </View>
      </Modal>

    </View>
  );
}

const PRIMARY = '#16A34A';

// Fallback map center when no location is available yet (Manila, PH).
const DEFAULT_REGION = {
  latitude: 14.5995,
  longitude: 120.9842,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg },

  // Section
  section: { marginBottom: spacing.lg },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },

  // Generic white card (product summary)
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  productInfo: { flex: 1 },
  productName: { ...typography.cardTitle, color: colors.text },
  productPrice: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: 3 },

  // Quantity stepper
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginLeft: spacing.md,
  },
  qtyButtonMinus: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonPlus: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonDisabled: { opacity: 0.6 },
  qtyValue: {
    minWidth: 24,
    height: 40,
    lineHeight: 40,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  quantityRowDisabled: { opacity: 0.5 },

  // Address card
  addressCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  addressIcon: { marginTop: 3, marginRight: spacing.sm },
  addressInput: {
    flex: 1,
    minHeight: 44,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 0,
  },
  addressPinButton: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  fieldError: { fontSize: 12, color: colors.danger, marginTop: 6 },

  // Bidding read-only summary card
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryIcon: { marginRight: spacing.sm },
  summaryText: { flex: 1, ...typography.body, color: colors.text },

  // Map picker (full-screen modal)
  pickerScreen: { flex: 1, backgroundColor: '#fff' },
  pickerMap: { ...StyleSheet.absoluteFillObject },
  pickerTopBar: {
    position: 'absolute',
    left: H_PADDING,
    right: H_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickerCloseButton: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.raised,
  },
  pickerSearchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    ...shadows.card,
  },
  pickerSearchText: { fontSize: 14, color: colors.textMuted },
  pickerBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: H_PADDING,
    paddingTop: spacing.lg,
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    gap: spacing.md,
    ...shadows.nav,
  },
  pickerLocateBtn: {
    position: 'absolute',
    top: -56,
    right: H_PADDING,
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.raised,
  },
  pickerLabel: { ...typography.label, color: colors.textMuted },
  pickerAddressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  pickerAddressIcon: { marginTop: 1 },
  pickerAddressText: { flex: 1, ...typography.body, color: colors.text },
  deliveryPin: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    ...shadows.raised,
  },

  // Helper note
  estimateNote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

  // Express delivery toggle
  expressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.amberTint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  expressIconCircle: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.amberTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expressTextWrap: { flex: 1 },
  expressLabel: { ...typography.cardTitle, color: colors.text },
  expressSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  // Error
  error: {
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: H_PADDING,
    paddingTop: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  buttonGap: { height: spacing.sm },
  limitBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.amberTint,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  limitBannerIcon: { marginRight: spacing.sm, marginTop: 1 },
  limitBannerText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.amberText },
});
