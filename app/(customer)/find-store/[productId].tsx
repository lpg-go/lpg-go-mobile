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
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppHeader from '../../../components/AppHeader';
import CustomerHeaderActions from '../../../components/CustomerHeaderActions';
import OrderBidding from '../../../components/order/OrderBidding';
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
  const [activeOrderCount, setActiveOrderCount] = useState(0);

  const [pickerVisible, setPickerVisible] = useState(false);

  const mapRef = useRef<MapView>(null);
  // Snapshot of address/coords when the picker opens, so Cancel can restore.
  const snapshotRef = useRef<{ address: string; lat: number | null; lng: number | null } | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    autoGetLocation();
  }, []);

  // Reset to a clean form state when opening Find Provider for a new product
  // (the route component is reused across products, so state would otherwise persist).
  // Address is intentionally left untouched so it persists across products.
  // Skipped entirely when resuming an existing order's bidding.
  useEffect(() => {
    if (resumeOrderId) return;
    setPhase('form');
    setOrderId(null);
    setAcceptances([]);
    setSelectedProviderId(null);
    setPendingProviderId(null);
    setQuantity(1);
  }, [productId, resumeOrderId]);

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
      .select('delivery_address')
      .eq('id', oid)
      .single();
    if (order) {
      setAddress(order.delivery_address ?? '');
    }

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
    }, [])
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
      .select('allow_cash_payment, allow_card_payment, max_active_orders_per_customer')
      .single()
      .then(({ data }) => {
        if (data) {
          setPaymentSettings(data);
          setPaymentMethod(data.allow_cash_payment ? 'cash' : data.allow_card_payment ? 'card' : null);
          setMaxActiveOrders(Number(data.max_active_orders_per_customer ?? 0));
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

    // Save the chosen payment method first
    const { error: paymentError } = await supabase
      .from('orders')
      .update({ payment_method: paymentMethod })
      .eq('id', orderId);

    if (paymentError) {
      setSelectingProvider(null);
      Alert.alert('Error', paymentError.message);
      return;
    }

    // Then run the provider selection RPC
    const { error } = await supabase.rpc('select_provider_for_order', {
      p_order_id: orderId,
      p_provider_id: pendingProviderId,
    });

    setSelectingProvider(null);
    if (!error) {
      sendOrderNotification(orderId, 'dealer_selected');
      sendOrderNotification(orderId, 'in_transit');
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
    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_by: 'customer' })
      .eq('id', orderId);
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

    const totalAmount = quantity * unitPriceNum;

    // Fetch admin_fee for this product and calculate total
    const { data: productRow, error: feesError } = await supabase
      .from('products')
      .select('id, admin_fee')
      .eq('id', productId)
      .single();

    if (feesError) {
      setPlacing(false);
      setError(feesError.message);
      return;
    }

    const totalAdminFee = Number(productRow?.admin_fee ?? 0) * quantity;

    const expiryMinutes = settings?.order_expiry_minutes ?? 10;
    // 0 means "never expire" — leave expires_at null so the cron skips it.
    const expiresAt =
      expiryMinutes > 0
        ? new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString()
        : null;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: user.id,
        status: 'pending',
        delivery_address: address.trim(),
        delivery_lat: lat,
        delivery_lng: lng,
        total_amount: totalAmount,
        admin_fee: totalAdminFee,
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (orderError) {
      setPlacing(false);
      setError(orderError.message);
      return;
    }

    const { error: itemsError } = await supabase.from('order_items').insert({
      order_id: order.id,
      product_id: productId,
      provider_product_id: providerProductId,
      quantity,
      unit_price: unitPriceNum,
      subtotal: quantity * unitPriceNum,
    });

    if (itemsError) {
      // Attempt to clean up the orphaned order
      await supabase.from('orders').delete().eq('id', order.id);
      setPlacing(false);
      setError(itemsError.message);
      return;
    }

    // Transition to awaiting_dealer_selection now that items are committed
    const { error: statusError } = await supabase
      .from('orders')
      .update({ status: 'awaiting_dealer_selection' })
      .eq('id', order.id);

    if (statusError) {
      console.log('[find-store] failed to set awaiting_dealer_selection:', statusError.message);
      // Non-fatal — order is placed, status will be corrected by the provider flow
    }

    console.log('[find-store] order placed, sending new_order notification for', order.id);
    sendOrderNotification(order.id, 'new_order');
    setPlacing(false);
    setOrderId(order.id);
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

  return (
    <View style={styles.screen}>
      <AppHeader showLogo right={<CustomerHeaderActions />} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 120 + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Delivery address */}
        <View style={[styles.section, { marginBottom: 10 }]}>
          <Text style={styles.sectionTitle}>Delivery Address</Text>

          <View style={styles.addressInputWrap}>
            {!inputsDisabled && (
              <TouchableOpacity
                style={styles.addressPinWrap}
                onPress={openPicker}
                hitSlop={8}
              >
                <View style={styles.addressPinButton}>
                  <Feather name="map-pin" size={20} color="#fff" />
                </View>
              </TouchableOpacity>
            )}
            <TextInput
              style={styles.addressInput}
              placeholder={locationLoading ? 'Getting your location…' : 'Enter your full delivery address'}
              placeholderTextColor="#9CA3AF"
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
          </View>

          {locationError ? <Text style={styles.fieldError}>{locationError}</Text> : null}
        </View>

        {/* Product summary */}
        <View style={styles.section}>
          <View style={styles.productCard}>
            <View style={styles.productInfo}>
              <Text style={styles.productName} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.productPrice}>Est. ₱{totalAmount.toLocaleString()}</Text>
            </View>
            <View style={[styles.quantityRow, inputsDisabled && styles.quantityRowDisabled]}>
              <TouchableOpacity
                style={[styles.qtyButton, quantity <= 1 && styles.qtyButtonDisabled]}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1 || inputsDisabled}
                hitSlop={8}
              >
                <Feather name="minus" size={20} color={quantity <= 1 ? '#9CA3AF' : '#fff'} />
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <TouchableOpacity
                style={styles.qtyButton}
                onPress={() => setQuantity((q) => q + 1)}
                disabled={inputsDisabled}
                hitSlop={8}
              >
                <Feather name="plus" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.estimateNote}>
            Final price depends on the provider you choose.
          </Text>
        </View>

        {phase === 'form' && error ? <Text style={styles.error}>{error}</Text> : null}

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
          onToggleSortDropdown={() => setSortDropdownOpen((v) => !v)}
          onSetSortBy={(key) => { setSortBy(key); setSortDropdownOpen(false); }}
          onSelectCard={(providerId) => setSelectedProviderId(providerId)}
          onOpenPayment={() => selectedProviderId && setPendingProviderId(selectedProviderId)}
          onSetPaymentMethod={setPaymentMethod}
          onConfirmSelection={confirmSelection}
          onClosePayment={() => setPendingProviderId(null)}
        />
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {phase === 'form' && atLimit && (
          <View style={styles.limitBanner}>
            <Feather name="info" size={18} color="#B45309" style={styles.limitBannerIcon} />
            <Text style={styles.limitBannerText}>
              Complete or cancel an order to place a new one.
            </Text>
          </View>
        )}
        {phase === 'form' ? (
          <TouchableOpacity
            style={[
              styles.placeOrderButton,
              (!canFindStore || placing || atLimit) && styles.placeOrderButtonDisabled,
            ]}
            onPress={handleFindStore}
            disabled={!canFindStore || placing || atLimit}
          >
            {placing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.placeOrderText}>Find Provider</Text>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.placeOrderButton, !selectedProviderId && styles.selectProviderDisabled]}
              onPress={() => selectedProviderId && setPendingProviderId(selectedProviderId)}
              disabled={!selectedProviderId}
            >
              <Text style={styles.placeOrderText}>Select Provider</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelBtn, cancelling && { opacity: 0.5 }]}
              onPress={confirmCancelOrder}
              disabled={cancelling}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color="#DC2626" />
              ) : (
                <Text style={styles.cancelBtnText}>Cancel Order</Text>
              )}
            </TouchableOpacity>
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

          {/* Top bar: close + hint */}
          <View style={[styles.pickerTopBar, { top: insets.top + 12 }]}>
            <TouchableOpacity
              style={styles.pickerCloseButton}
              onPress={cancelPicker}
              hitSlop={8}
            >
              <Feather name="x" size={22} color="#111827" />
            </TouchableOpacity>
            <View style={styles.pickerHint}>
              <Feather name="move" size={12} color="#6B7280" />
              <Text style={styles.pickerHintText}>Tap the map or drag the pin</Text>
            </View>
          </View>

          {/* Bottom controls */}
          <View style={[styles.pickerBottomBar, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              style={styles.pickerUseLocation}
              onPress={handleUseLocation}
              disabled={locationLoading}
            >
              {locationLoading ? (
                <ActivityIndicator size="small" color={PRIMARY} />
              ) : (
                <Feather name="navigation" size={16} color={PRIMARY} />
              )}
              <Text style={styles.pickerUseLocationText}>
                {locationLoading ? 'Getting location...' : 'Use Current Location'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmButton, lat === null && styles.confirmButtonDisabled]}
              onPress={confirmPicker}
              disabled={lat === null}
            >
              <Text style={styles.confirmButtonText}>Confirm Location</Text>
            </TouchableOpacity>
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
  screen: { flex: 1, backgroundColor: '#F9FAFB' },


  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 16 },

  // Section
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },

  // Product card
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  productInfo: { flex: 1 },
  productName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  productMeta: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  productPrice: { fontSize: 12, fontWeight: '700', color: PRIMARY, marginTop: 3 },

  // Quantity
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 12,
  },
  qtyButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonDisabled: { backgroundColor: '#F3F4F6' },
  qtyValue: {
    minWidth: 24,
    height: 40,
    lineHeight: 40,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  quantityRowDisabled: { opacity: 0.5 },

  // Address
  addressInputWrap: {
    position: 'relative',
    marginBottom: 10,
  },
  addressPinWrap: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 1,
  },
  addressPinButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingLeft: 14,
    paddingRight: 62,
    paddingVertical: 12,
    fontSize: 14,
    color: '#111827',
    height: 68,
  },
  fieldError: { fontSize: 12, color: '#EF4444', marginTop: 6 },

  // Map picker (full-screen modal)
  pickerScreen: { flex: 1, backgroundColor: '#fff' },
  pickerMap: { ...StyleSheet.absoluteFillObject },
  pickerTopBar: {
    position: 'absolute',
    left: H_PADDING,
    right: H_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickerCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  pickerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  pickerHintText: { fontSize: 12, color: '#6B7280' },
  pickerBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: H_PADDING,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 10,
  },
  pickerUseLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  pickerUseLocationText: { fontSize: 14, fontWeight: '600', color: PRIMARY },
  confirmButton: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  deliveryPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },

  // Helper note
  estimateNote: { fontSize: 12, color: '#9CA3AF', marginTop: 8 },

  // Error
  error: {
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
    marginBottom: 8,
  },

  // Bottom bar
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
  placeOrderButton: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  limitBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  limitBannerIcon: { marginRight: 8, marginTop: 1 },
  limitBannerText: { flex: 1, fontSize: 13, lineHeight: 18, color: '#92400E' },
  placeOrderButtonDisabled: { opacity: 0.6 },
  selectProviderDisabled: { opacity: 0.5 },
  placeOrderText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Cancel (matches provider order status cancel button)
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 10,
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: '#DC2626' },
});
