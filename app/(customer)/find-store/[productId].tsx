import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
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

import { sendOrderNotification } from '../../../lib/notifications';
import supabase from '../../../lib/supabase';

type PlatformSettings = {
  order_expiry_minutes: number;
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
  } = useLocalSearchParams<{
    productId: string;
    productName: string;
    brandName: string;
    sizeKg: string;
    unitPrice: string;
    maxPrice: string;
    providerProductId: string;
  }>();

  const unitPriceNum = Number(unitPrice);
  const maxPriceNum = Number(maxPrice);

  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');

  const [quantity, setQuantity] = useState(1);

  const [settings, setSettings] = useState<PlatformSettings | null>(null);

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  const [pickerVisible, setPickerVisible] = useState(false);

  const mapRef = useRef<MapView>(null);
  // Snapshot of address/coords when the picker opens, so Cancel can restore.
  const snapshotRef = useRef<{ address: string; lat: number | null; lng: number | null } | null>(null);

  useEffect(() => {
    autoGetLocation();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchSettings();
    }, [])
  );

  async function fetchSettings() {
    const { data } = await supabase
      .from('platform_settings')
      .select('order_expiry_minutes')
      .single();

    if (data) {
      setSettings(data);
    }
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
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

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
    router.replace({ pathname: '/(customer)/order/[id]', params: { id: order.id } });
  }

  const totalAmount = quantity * unitPriceNum;
  const canFindStore = address.trim().length > 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <Feather name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Find Store</Text>
        <View style={{ width: 34 }} />
      </View>

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
            <TouchableOpacity
              style={styles.addressPinWrap}
              onPress={openPicker}
              hitSlop={8}
            >
              <View style={styles.addressPinButton}>
                <Feather name="map-pin" size={20} color="#fff" />
              </View>
            </TouchableOpacity>
            <TextInput
              style={styles.addressInput}
              placeholder="Enter your full delivery address"
              placeholderTextColor="#9CA3AF"
              value={address}
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
              <Text style={styles.productName} numberOfLines={1}>{productName}</Text>
              <Text style={styles.productPrice}>Est. ₱{totalAmount.toLocaleString()}</Text>
            </View>
            <View style={styles.quantityRow}>
              <TouchableOpacity
                style={[styles.qtyButton, quantity <= 1 && styles.qtyButtonDisabled]}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                hitSlop={8}
              >
                <Feather name="minus" size={20} color={quantity <= 1 ? '#9CA3AF' : '#fff'} />
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <TouchableOpacity
                style={styles.qtyButton}
                onPress={() => setQuantity((q) => q + 1)}
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

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {/* Find Store bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[
            styles.placeOrderButton,
            (!canFindStore || placing) && styles.placeOrderButtonDisabled,
          ]}
          onPress={handleFindStore}
          disabled={!canFindStore || placing}
        >
          {placing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.placeOrderText}>Find Store</Text>
          )}
        </TouchableOpacity>
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
  placeOrderButtonDisabled: { opacity: 0.6 },
  placeOrderText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
