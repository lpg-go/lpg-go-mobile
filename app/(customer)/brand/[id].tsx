import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCart } from '../../../lib/cartStore';
import supabase from '../../../lib/supabase';

type Product = {
  id: string;
  name: string;
  size_kg: number;
  minPrice: number | null;
  maxPrice: number | null;
  cheapestProviderProductId: string | null;
};

const COLUMN_GAP = 12;
const H_PADDING = 20;
const CARD_WIDTH = (Dimensions.get('window').width - H_PADDING * 2 - COLUMN_GAP) / 2;

export default function BrandProductsScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const insets = useSafeAreaInsets();
  const { addItem, items, totalItems } = useCart();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  async function fetchProducts() {
    const { data: productRows } = await supabase
      .from('products')
      .select('id, name, size_kg')
      .eq('brand_id', id)
      .eq('is_active', true)
      .order('size_kg');

    if (!productRows || productRows.length === 0) {
      setLoading(false);
      return;
    }

    const productIds = productRows.map((p) => p.id);

    const { data: priceRows } = await supabase
      .from('provider_products')
      .select('id, product_id, price')
      .in('product_id', productIds)
      .eq('is_available', true);

    const entriesByProduct: Record<string, { id: string; price: number }[]> = {};
    for (const row of priceRows ?? []) {
      if (!entriesByProduct[row.product_id]) entriesByProduct[row.product_id] = [];
      entriesByProduct[row.product_id].push({ id: row.id, price: Number(row.price) });
    }

    setProducts(
      productRows.map((p) => {
        const entries = entriesByProduct[p.id];
        if (!entries || entries.length === 0) {
          return { id: p.id, name: p.name, size_kg: p.size_kg, minPrice: null, maxPrice: null, cheapestProviderProductId: null };
        }
        entries.sort((a, b) => a.price - b.price);
        return {
          id: p.id,
          name: p.name,
          size_kg: p.size_kg,
          minPrice: entries[0].price,
          maxPrice: entries[entries.length - 1].price,
          cheapestProviderProductId: entries[0].id,
        };
      })
    );
    setLoading(false);
  }

  function handleAddToCart(product: Product) {
    addItem({
      product_id: product.id,
      product_name: product.name,
      brand_name: name ?? '',
      quantity: 1,
      unit_price: product.minPrice!,
      provider_product_id: product.cheapestProviderProductId!,
    });
  }

  function cartQuantityFor(productId: string) {
    return items.find((i) => i.product_id === productId)?.quantity ?? 0;
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <Feather name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>{name}</Text>

        <TouchableOpacity
          style={styles.cartIconWrap}
          onPress={() => router.push('/(customer)/cart')}
          hitSlop={8}
        >
          <Feather name="shopping-cart" size={22} color={PRIMARY} />
          {totalItems > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{totalItems > 99 ? '99+' : totalItems}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : products.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="inbox" size={40} color="#D1D5DB" />
          <Text style={styles.emptyText}>No products available</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        >
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              quantity={cartQuantityFor(product.id)}
              onAddToCart={() => handleAddToCart(product)}
            />
          ))}
          {totalItems > 0 && <View style={{ height: 80, width: '100%' }} />}
        </ScrollView>
      )}

      {/* Floating View Cart button */}
      {totalItems > 0 && (
        <View style={[styles.floatingBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={styles.viewCartButton}
            onPress={() => router.push('/(customer)/cart')}
          >
            <Text style={styles.viewCartText}>View Cart</Text>
            <View style={styles.viewCartBadge}>
              <Text style={styles.viewCartBadgeText}>{totalItems}</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function ProductCard({
  product,
  quantity,
  onAddToCart,
}: {
  product: Product;
  quantity: number;
  onAddToCart: () => void;
}) {
  const hasPrice = product.minPrice !== null;
  const samePrice = product.minPrice === product.maxPrice;

  return (
    <View style={styles.card}>
      <Text style={styles.sizeLabel}>{product.size_kg}kg</Text>
      <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>

      {hasPrice ? (
        <Text style={styles.price}>
          {samePrice
            ? `₱${product.minPrice!.toLocaleString()}`
            : `₱${product.minPrice!.toLocaleString()} – ₱${product.maxPrice!.toLocaleString()}`}
        </Text>
      ) : (
        <Text style={styles.unavailable}>Unavailable</Text>
      )}

      <TouchableOpacity
        style={[styles.addButton, !hasPrice && styles.addButtonDisabled]}
        onPress={onAddToCart}
        disabled={!hasPrice}
      >
        <Text style={styles.addButtonText}>
          {quantity > 0 ? `In Cart (${quantity})` : 'Add to Cart'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: H_PADDING,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: { marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#111827' },
  cartIconWrap: { position: 'relative', padding: 4 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // States
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: '#9CA3AF' },

  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: H_PADDING,
    paddingTop: 16,
    gap: COLUMN_GAP,
  },

  // Product card
  card: {
    width: CARD_WIDTH,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fff',
  },
  sizeLabel: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 2 },
  productName: { fontSize: 13, color: '#6B7280', marginBottom: 8, minHeight: 34 },
  price: { fontSize: 13, fontWeight: '600', color: PRIMARY, marginBottom: 10 },
  unavailable: { fontSize: 13, fontWeight: '600', color: '#EF4444', marginBottom: 10 },
  addButton: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  addButtonDisabled: { backgroundColor: '#E5E7EB' },
  addButtonText: { fontSize: 13, fontWeight: '600', color: '#fff' },

  // Floating cart bar
  floatingBar: {
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
  viewCartButton: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  viewCartText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  viewCartBadge: {
    backgroundColor: '#fff',
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  viewCartBadgeText: { fontSize: 12, fontWeight: '700', color: PRIMARY },
});
