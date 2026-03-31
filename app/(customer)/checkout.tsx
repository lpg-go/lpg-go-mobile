import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCart } from '../../lib/cartStore';
import supabase from '../../lib/supabase';

type PaymentMethod = 'cash' | 'card';

type PlatformSettings = {
  allow_cash_payment: boolean;
  allow_card_payment: boolean;
  order_expiry_minutes: number;
};

const H_PADDING = 20;

export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const { items, totalAmount, clearCart } = useCart();

  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    const { data } = await supabase
      .from('platform_settings')
      .select('allow_cash_payment, allow_card_payment, order_expiry_minutes')
      .single();

    if (data) {
      setSettings(data);
      // Pre-select first available method
      if (data.allow_cash_payment) setPaymentMethod('cash');
      else if (data.allow_card_payment) setPaymentMethod('card');
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

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude } = position.coords;
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

    setLocationLoading(false);
  }

  async function handlePlaceOrder() {
    setError('');

    if (!address.trim()) {
      setError('Please enter a delivery address.');
      return;
    }
    if (!paymentMethod) {
      setError('Please select a payment method.');
      return;
    }
    if (items.length === 0) {
      setError('Your cart is empty.');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Not authenticated.');
      return;
    }

    setPlacing(true);

    const expiryMinutes = settings?.order_expiry_minutes ?? 10;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: user.id,
        status: 'pending',
        payment_method: paymentMethod,
        delivery_address: address.trim(),
        delivery_lat: lat,
        delivery_lng: lng,
        total_amount: totalAmount,
        admin_fee: 0,
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (orderError) {
      setPlacing(false);
      setError(orderError.message);
      return;
    }

    const orderItems = items.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      provider_product_id: item.provider_product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.quantity * item.unit_price,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);

    if (itemsError) {
      // Attempt to clean up the orphaned order
      await supabase.from('orders').delete().eq('id', order.id);
      setPlacing(false);
      setError(itemsError.message);
      return;
    }

    clearCart();
    setPlacing(false);
    router.replace({ pathname: '/(customer)/order/[id]', params: { id: order.id } });
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <Feather name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
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
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery Address</Text>

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

          <TouchableOpacity
            style={[styles.locationButton, locationLoading && styles.locationButtonDisabled]}
            onPress={handleUseLocation}
            disabled={locationLoading}
          >
            {locationLoading ? (
              <ActivityIndicator size="small" color={PRIMARY} />
            ) : (
              <Feather name="map-pin" size={16} color={PRIMARY} />
            )}
            <Text style={styles.locationButtonText}>
              {locationLoading ? 'Getting location...' : 'Use current location'}
            </Text>
          </TouchableOpacity>

          {locationError ? <Text style={styles.fieldError}>{locationError}</Text> : null}
          {lat !== null && (
            <Text style={styles.coordsHint}>
              📍 GPS: {lat.toFixed(5)}, {lng!.toFixed(5)}
            </Text>
          )}
        </View>

        {/* Order summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <View style={styles.summaryCard}>
            {items.map((item) => (
              <View key={item.product_id} style={styles.summaryRow}>
                <View style={styles.summaryLeft}>
                  <Text style={styles.summaryItemName} numberOfLines={1}>
                    {item.product_name}
                  </Text>
                  <Text style={styles.summaryItemBrand}>{item.brand_name}</Text>
                </View>
                <Text style={styles.summaryQty}>×{item.quantity}</Text>
                <Text style={styles.summarySubtotal}>
                  ₱{(item.quantity * item.unit_price).toLocaleString()}
                </Text>
              </View>
            ))}

            <View style={styles.divider} />

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>₱{totalAmount.toLocaleString()}</Text>
            </View>
          </View>
        </View>

        {/* Payment method */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>

          {settings === null ? (
            <ActivityIndicator color={PRIMARY} style={{ marginTop: 8 }} />
          ) : (
            <View style={styles.paymentOptions}>
              {settings.allow_cash_payment && (
                <PaymentOption
                  label="Cash on Delivery"
                  icon="dollar-sign"
                  selected={paymentMethod === 'cash'}
                  onPress={() => setPaymentMethod('cash')}
                />
              )}
              {settings.allow_card_payment && (
                <PaymentOption
                  label="Card Payment"
                  icon="credit-card"
                  selected={paymentMethod === 'card'}
                  onPress={() => setPaymentMethod('card')}
                />
              )}
            </View>
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {/* Place Order bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.placeOrderButton, placing && styles.placeOrderButtonDisabled]}
          onPress={handlePlaceOrder}
          disabled={placing}
        >
          {placing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.placeOrderText}>Place Order</Text>
              <Text style={styles.placeOrderAmount}>₱{totalAmount.toLocaleString()}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PaymentOption({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.paymentOption, selected && styles.paymentOptionSelected]}
      onPress={onPress}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <Feather
        name={icon as any}
        size={18}
        color={selected ? PRIMARY : '#6B7280'}
        style={{ marginRight: 10 }}
      />
      <Text style={[styles.paymentLabel, selected && styles.paymentLabelSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const PRIMARY = '#16A34A';

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

  // Address
  addressInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#111827',
    minHeight: 80,
    marginBottom: 10,
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  locationButtonDisabled: { borderColor: '#D1D5DB' },
  locationButtonText: { fontSize: 13, fontWeight: '500', color: PRIMARY },
  fieldError: { fontSize: 12, color: '#EF4444', marginTop: 6 },
  coordsHint: { fontSize: 11, color: '#9CA3AF', marginTop: 6 },

  // Summary card
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  summaryLeft: { flex: 1 },
  summaryItemName: { fontSize: 13, fontWeight: '600', color: '#111827' },
  summaryItemBrand: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  summaryQty: { fontSize: 13, color: '#6B7280', marginHorizontal: 12 },
  summarySubtotal: { fontSize: 13, fontWeight: '600', color: '#111827', minWidth: 64, textAlign: 'right' },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 8 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { fontSize: 14, fontWeight: '700', color: '#111827' },
  totalValue: { fontSize: 16, fontWeight: '800', color: PRIMARY },

  // Payment
  paymentOptions: { gap: 10 },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  paymentOptionSelected: {
    borderColor: PRIMARY,
    backgroundColor: '#F0FDF4',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioSelected: { borderColor: PRIMARY },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PRIMARY,
  },
  paymentLabel: { fontSize: 14, fontWeight: '500', color: '#374151' },
  paymentLabelSelected: { color: PRIMARY, fontWeight: '600' },

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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  placeOrderButtonDisabled: { opacity: 0.6 },
  placeOrderText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  placeOrderAmount: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
