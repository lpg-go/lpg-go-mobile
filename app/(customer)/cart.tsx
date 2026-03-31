import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CartItem, useCart } from '../../lib/cartStore';

const H_PADDING = 20;

export default function CartScreen() {
  const insets = useSafeAreaInsets();
  const { items, removeItem, updateQuantity, totalItems, totalAmount } = useCart();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <Feather name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Cart</Text>
        <View style={{ width: 34 }} />
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="shopping-cart" size={56} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptySubtitle}>Add products to get started</Text>
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => router.replace('/(customer)')}
          >
            <Text style={styles.browseButtonText}>Browse Brands</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: 200 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {items.map((item) => (
              <CartRow
                key={item.product_id}
                item={item}
                onRemove={() => removeItem(item.product_id)}
                onDecrement={() => updateQuantity(item.product_id, item.quantity - 1)}
                onIncrement={() => updateQuantity(item.product_id, item.quantity + 1)}
              />
            ))}

            {/* Order summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Order Summary</Text>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  Subtotal ({totalItems} {totalItems === 1 ? 'item' : 'items'})
                </Text>
                <Text style={styles.summaryValue}>₱{totalAmount.toLocaleString()}</Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Delivery fee</Text>
                <Text style={styles.summaryMuted}>Calculated at checkout</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.summaryRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>₱{totalAmount.toLocaleString()}</Text>
              </View>
            </View>
          </ScrollView>

          {/* Checkout bar */}
          <View style={[styles.checkoutBar, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              style={styles.checkoutButton}
              onPress={() => router.push('/(customer)/checkout')}
            >
              <Text style={styles.checkoutButtonText}>Proceed to Checkout</Text>
              <Text style={styles.checkoutAmount}>₱{totalAmount.toLocaleString()}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

function CartRow({
  item,
  onRemove,
  onDecrement,
  onIncrement,
}: {
  item: CartItem;
  onRemove: () => void;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  const subtotal = item.quantity * item.unit_price;

  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={2}>{item.product_name}</Text>
        <Text style={styles.rowBrand}>{item.brand_name}</Text>
        <Text style={styles.rowPrice}>₱{item.unit_price.toLocaleString()} each</Text>
      </View>

      <View style={styles.rowRight}>
        <TouchableOpacity onPress={onRemove} hitSlop={8} style={styles.trashButton}>
          <Feather name="trash-2" size={16} color="#EF4444" />
        </TouchableOpacity>

        <View style={styles.qtyControls}>
          <TouchableOpacity style={styles.qtyButton} onPress={onDecrement} hitSlop={6}>
            <Feather name="minus" size={14} color={PRIMARY} />
          </TouchableOpacity>
          <Text style={styles.qtyNumber}>{item.quantity}</Text>
          <TouchableOpacity style={styles.qtyButton} onPress={onIncrement} hitSlop={6}>
            <Feather name="plus" size={14} color={PRIMARY} />
          </TouchableOpacity>
        </View>

        <Text style={styles.subtotal}>₱{subtotal.toLocaleString()}</Text>
      </View>
    </View>
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

  // Cart row
  row: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  rowBody: { flex: 1, paddingRight: 12 },
  rowName: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 2 },
  rowBrand: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  rowPrice: { fontSize: 13, color: '#6B7280' },
  rowRight: { alignItems: 'flex-end', justifyContent: 'space-between', minWidth: 100 },
  trashButton: { padding: 2 },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  qtyButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F9FAFB',
  },
  qtyNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    minWidth: 28,
    textAlign: 'center',
  },
  subtotal: { fontSize: 14, fontWeight: '700', color: PRIMARY },

  // Summary card
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  summaryTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 14 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: { fontSize: 14, color: '#6B7280' },
  summaryValue: { fontSize: 14, fontWeight: '600', color: '#111827' },
  summaryMuted: { fontSize: 13, color: '#9CA3AF', fontStyle: 'italic' },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 10 },
  totalLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  totalValue: { fontSize: 17, fontWeight: '800', color: PRIMARY },

  // Checkout bar
  checkoutBar: {
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
  checkoutButton: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  checkoutButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  checkoutAmount: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: H_PADDING,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 4 },
  emptySubtitle: { fontSize: 14, color: '#9CA3AF' },
  browseButton: {
    marginTop: 8,
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  browseButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
