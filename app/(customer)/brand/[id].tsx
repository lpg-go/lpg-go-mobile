import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import BrandProductImage from '../../../components/ui/BrandProductImage';
import DetailHeader from '../../../components/ui/DetailHeader';
import { colors, radii, spacing, shadows } from '../../../lib/theme';
import supabase from '../../../lib/supabase';

type Product = {
  id: string;
  name: string;
  size_kg: number;
  image_url: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  cheapestProviderProductId: string | null;
};

const COLS = 3;
const H_PADDING = 16;
const GRID_GAP = 16;
const CARD_WIDTH = (Dimensions.get('window').width - H_PADDING * 2 - GRID_GAP * (COLS - 1)) / COLS;

export default function BrandProductsScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Clear stale data immediately when brand changes
  useEffect(() => {
    setProducts([]);
    setLoading(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      fetchProducts();
      return () => {};
    }, [id])
  );

  async function fetchProducts() {
    const { data: productRows } = await supabase
      .from('products')
      .select('id, name, size_kg, image_url')
      .eq('brand_id', id)
      .eq('is_active', true)
      .order('size_kg');

    if (!productRows || productRows.length === 0) {
      setLoading(false);
      return;
    }

    const productIds = productRows.map((p) => p.id);

    // Note: Realtime on provider_products requires the table to be added to the
    // supabase_realtime publication. Until then, useFocusEffect handles refresh on focus.
    const { data: priceRows } = await supabase
      .from('provider_products')
      .select('id, product_id, price, provider:profiles!provider_products_provider_id_fkey(is_online, is_approved)')
      .in('product_id', productIds)
      .eq('is_available', true);

    const activeRows = (priceRows ?? []).filter(
      (row) => row.provider?.is_online === true && row.provider?.is_approved === true
    );

    const entriesByProduct: Record<string, { id: string; price: number }[]> = {};
    for (const row of activeRows) {
      if (!entriesByProduct[row.product_id]) entriesByProduct[row.product_id] = [];
      entriesByProduct[row.product_id].push({ id: row.id, price: Number(row.price) });
    }

    setProducts(
      productRows.map((p) => {
        const entries = entriesByProduct[p.id];
        if (!entries || entries.length === 0) {
          return { id: p.id, name: p.name, size_kg: p.size_kg, image_url: p.image_url ?? null, minPrice: null, maxPrice: null, cheapestProviderProductId: null };
        }
        entries.sort((a, b) => a.price - b.price);
        return {
          id: p.id,
          name: p.name,
          size_kg: p.size_kg,
          image_url: p.image_url ?? null,
          minPrice: entries[0].price,
          maxPrice: entries[entries.length - 1].price,
          cheapestProviderProductId: entries[0].id,
        };
      })
    );
    setLoading(false);
  }

  function handleFindStore(product: Product) {
    router.push({
      pathname: '/(customer)/find-store/[productId]',
      params: {
        productId: product.id,
        productName: product.name,
        brandName: name ?? '',
        sizeKg: String(product.size_kg),
        unitPrice: String(product.minPrice),
        maxPrice: String(product.maxPrice),
        providerProductId: product.cheapestProviderProductId!,
      },
    });
  }

  return (
    <View style={styles.screen}>
      <DetailHeader
        title={name || 'Brand'}
        subtitle="Choose a cylinder size"
        onBack={() => router.back()}
      />

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : products.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="inbox" size={40} color={colors.textFaint} />
          <Text style={styles.emptyText}>No products available</Text>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          numColumns={COLS}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: product }) => (
            <ProductCard
              product={product}
              onFindStore={() => handleFindStore(product)}
            />
          )}
        />
      )}
    </View>
  );
}

function ProductCard({
  product,
  onFindStore,
}: {
  product: Product;
  onFindStore: () => void;
}) {
  const inStock = product.minPrice !== null;

  return (
    <TouchableOpacity
      style={[styles.card, !inStock && styles.cardDisabled]}
      onPress={onFindStore}
      disabled={!inStock}
      activeOpacity={0.75}
    >
      <View style={styles.imageZone}>
        <BrandProductImage
          url={product.image_url}
          style={styles.image}
          resizeMode="cover"
          iconSize={32}
          iconColor={colors.primary}
        />
        {!inStock && (
          <View style={styles.unavailableOverlay}>
            <View style={styles.unavailablePill}>
              <Text style={styles.unavailablePillText}>Unavailable</Text>
            </View>
          </View>
        )}
        <View style={[styles.sizeBadge, !inStock && styles.sizeBadgeUnavailable]}>
          <Text style={styles.sizeBadgeValue}>{product.size_kg}</Text>
          <Text style={styles.sizeBadgeUnit}>kg</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  // States
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyText: { fontSize: 15, color: colors.textMuted },

  // List
  listContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  row: { gap: GRID_GAP, marginBottom: GRID_GAP },

  // Product card
  card: {
    width: CARD_WIDTH,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
    ...shadows.card,
  },
  cardDisabled: { opacity: 0.5 },
  imageZone: {
    aspectRatio: 1,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  unavailableOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailablePill: {
    backgroundColor: '#F3F4F6',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  unavailablePillText: { fontSize: 9, fontWeight: '700', color: colors.textSecondary },

  // Modern size badge — floats over the square image, bottom-left
  sizeBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    ...shadows.card,
  },
  sizeBadgeUnavailable: { backgroundColor: 'rgba(255,255,255,0.75)' },
  sizeBadgeValue: { fontSize: 15, fontWeight: '800', color: colors.text },
  sizeBadgeUnit: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
});
