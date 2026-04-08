import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import supabase from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProviderProduct = {
  id: string;
  product_id: string;
  product_name: string;
  size_kg: number;
  brand_name: string;
  logo_url: string | null;
  image_url: string | null;
  price: number;
  stock: number;
  admin_fee: number;
};

type BrandGroup = {
  brand_name: string;
  logo_url: string | null;
  products: ProviderProduct[];
};

type SaveState = 'idle' | 'saving' | 'saved';

const AVATAR_COLORS = ['#16A34A', '#2563EB', '#D97706', '#7C3AED', '#DC2626', '#0891B2'];
function getBrandColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}
function getInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

const H_PADDING = 20;
const PRIMARY = '#16A34A';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProviderProductsScreen() {
  const insets = useSafeAreaInsets();

  const [products, setProducts] = useState<ProviderProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsedBrands, setCollapsedBrands] = useState<Set<string>>(new Set());
  const collapsedInitialized = useRef(false);

  useFocusEffect(
    useCallback(() => {
      fetchProducts().finally(() => setLoading(false));

      let channel: ReturnType<typeof supabase.channel> | null = null;
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        channel = supabase
          .channel('provider_products_changes')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'provider_products', filter: `provider_id=eq.${user.id}` },
            () => fetchProducts()
          )
          .subscribe();
      });

      return () => {
        if (channel) supabase.removeChannel(channel);
      };
    }, [])
  );

  const fetchProducts = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('provider_products')
      .select(`
        id,
        product_id,
        price,
        stock,
        product:products (
          name,
          size_kg,
          image_url,
          admin_fee,
          brand:brands ( name, logo_url )
        )
      `)
      .eq('provider_id', user.id)
      .order('product_id');

    if (error) { Alert.alert('Error', error.message); return; }

    const rows: ProviderProduct[] = (data ?? [])
      .filter((row: any) => row.product && row.product.brand)
      .map((row: any) => ({
        id: row.id,
        product_id: row.product_id,
        product_name: row.product.name,
        size_kg: row.product.size_kg,
        brand_name: row.product.brand.name,
        logo_url: row.product.brand.logo_url ?? null,
        image_url: row.product.image_url ?? null,
        price: Number(row.price),
        stock: row.stock,
        admin_fee: Number(row.product.admin_fee),
      }));

    setProducts(rows);

    if (!collapsedInitialized.current && rows.length > 0) {
      const sortedBrands = [...new Set(rows.map((r) => r.brand_name))].sort();
      setCollapsedBrands(new Set(sortedBrands.slice(1)));
      collapsedInitialized.current = true;
    }
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchProducts().finally(() => setRefreshing(false));
  }

  function handlePriceChange(id: string, newPrice: number) {
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, price: newPrice } : p));
  }

  function handleStockChange(id: string, newStock: number) {
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, stock: newStock } : p));
  }

  function toggleBrand(brandName: string) {
    setCollapsedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brandName)) next.delete(brandName);
      else next.add(brandName);
      return next;
    });
  }

  const brandGroups: BrandGroup[] = [];
  for (const p of products) {
    const group = brandGroups.find((g) => g.brand_name === p.brand_name);
    if (group) group.products.push(p);
    else brandGroups.push({ brand_name: p.brand_name, logo_url: p.logo_url, products: [p] });
  }
  brandGroups.sort((a, b) => a.brand_name.localeCompare(b.brand_name));

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Products</Text>
      </View>

      {products.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PRIMARY} colors={[PRIMARY]} />
          }
        >
          <Feather name="box" size={48} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No products available</Text>
          <Text style={styles.emptySubtitle}>Pull down to refresh.</Text>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PRIMARY} colors={[PRIMARY]} />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {brandGroups.map((group) => {
            const collapsed = collapsedBrands.has(group.brand_name);
            return (
              <View key={group.brand_name} style={styles.brandSection}>
                <TouchableOpacity
                  style={styles.brandHeaderRow}
                  onPress={() => toggleBrand(group.brand_name)}
                  activeOpacity={0.7}
                >
                  {group.logo_url ? (
                    <Image source={{ uri: group.logo_url }} style={styles.brandLogo} resizeMode="contain" />
                  ) : (
                    <View style={[styles.brandLogoFallback, { backgroundColor: getBrandColor(group.brand_name) }]}>
                      <Text style={styles.brandLogoInitials}>{getInitials(group.brand_name)}</Text>
                    </View>
                  )}
                  <Text style={styles.brandHeader}>{group.brand_name}</Text>
                  <Feather name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color="#9CA3AF" />
                </TouchableOpacity>

                {!collapsed && (
                  <View style={styles.brandCard}>
                    {group.products.map((product, index) => (
                      <ProductRow
                        key={product.id}
                        product={product}
                        isLast={index === group.products.length - 1}
                        onPriceChange={(v) => handlePriceChange(product.id, v)}
                        onStockChange={(v) => handleStockChange(product.id, v)}
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Product row ──────────────────────────────────────────────────────────────

function ProductRow({
  product,
  isLast,
  onPriceChange,
  onStockChange,
}: {
  product: ProviderProduct;
  isLast: boolean;
  onPriceChange: (v: number) => void;
  onStockChange: (v: number) => void;
}) {
  const [priceText, setPriceText] = useState(String(product.price));
  const [stockText, setStockText] = useState(String(product.stock));
  const [priceSave, setPriceSave] = useState<SaveState>('idle');
  const [stockSave, setStockSave] = useState<SaveState>('idle');
  const priceRef = useRef<TextInput>(null);
  const stockRef = useRef<TextInput>(null);

  async function savePrice() {
    const parsed = parseFloat(priceText);
    if (isNaN(parsed) || parsed < 0) {
      setPriceText(String(product.price));
      return;
    }
    setPriceSave('saving');
    const { error } = await supabase
      .from('provider_products')
      .update({ price: parsed })
      .eq('id', product.id);
    if (error) {
      Alert.alert('Error', error.message);
      setPriceText(String(product.price));
      setPriceSave('idle');
      return;
    }
    onPriceChange(parsed);
    setPriceSave('saved');
    setTimeout(() => setPriceSave('idle'), 1500);
  }

  async function saveStock() {
    const parsed = parseInt(stockText, 10);
    if (isNaN(parsed) || parsed < 0) {
      setStockText(String(product.stock));
      return;
    }
    setStockSave('saving');
    const { error } = await supabase
      .from('provider_products')
      .update({ stock: parsed })
      .eq('id', product.id);
    if (error) {
      Alert.alert('Error', error.message);
      setStockText(String(product.stock));
      setStockSave('idle');
      return;
    }
    onStockChange(parsed);
    setStockSave('saved');
    setTimeout(() => setStockSave('idle'), 1500);
  }

  const stockNum = parseInt(stockText, 10);
  const stockColor =
    isNaN(stockNum) || stockNum === 0 ? '#EF4444' :
    stockNum <= 10 ? '#D97706' :
    PRIMARY;

  return (
    <View style={[styles.productRow, !isLast && styles.productRowBorder]}>
      {/* Thumbnail */}
      <View style={styles.productThumb}>
        {product.image_url ? (
          <Image source={{ uri: product.image_url }} style={styles.productThumbImage} resizeMode="contain" />
        ) : (
          <Text style={styles.thumbSizeText}>{product.size_kg}kg</Text>
        )}
      </View>

      {/* Name + size + admin fee */}
      <View style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={1}>{product.product_name}</Text>
        <Text style={styles.productSize}>{product.size_kg}kg</Text>
        <Text style={styles.adminFeeText}>Fee: ₱{product.admin_fee.toLocaleString()}</Text>
      </View>

      {/* Price field */}
      <View style={styles.fieldWrap}>
        <Text style={styles.fieldLabel}>Price</Text>
        <TouchableOpacity
          style={styles.inputTouchable}
          onPress={() => priceRef.current?.focus()}
          activeOpacity={1}
        >
          <Text style={styles.pesoPrefix}>₱</Text>
          <TextInput
            ref={priceRef}
            style={styles.fieldInput}
            value={priceText}
            onChangeText={setPriceText}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onBlur={savePrice}
            onSubmitEditing={savePrice}
            selectTextOnFocus
          />
          {priceSave === 'saving' && <ActivityIndicator size="small" color="#9CA3AF" style={styles.saveIndicator} />}
          {priceSave === 'saved' && <Feather name="check" size={12} color={PRIMARY} style={styles.saveIndicator} />}
        </TouchableOpacity>
      </View>

      {/* Stock field */}
      <View style={styles.fieldWrap}>
        <Text style={styles.fieldLabel}>Stock</Text>
        <TouchableOpacity
          style={styles.inputTouchable}
          onPress={() => stockRef.current?.focus()}
          activeOpacity={1}
        >
          <TextInput
            ref={stockRef}
            style={[styles.fieldInput, { color: stockColor, fontWeight: '700' }]}
            value={stockText}
            onChangeText={setStockText}
            keyboardType="number-pad"
            returnKeyType="done"
            onBlur={saveStock}
            onSubmitEditing={saveStock}
            selectTextOnFocus
          />
          {stockSave === 'saving' && <ActivityIndicator size="small" color="#9CA3AF" style={styles.saveIndicator} />}
          {stockSave === 'saved' && <Feather name="check" size={12} color={PRIMARY} style={styles.saveIndicator} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PADDING,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 16, paddingBottom: 32 },

  brandSection: { marginBottom: 20 },
  brandHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingVertical: 2,
  },
  brandLogo: { width: 40, height: 40, borderRadius: 8 },
  brandLogoFallback: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogoInitials: { fontSize: 14, fontWeight: '700', color: '#fff' },
  brandHeader: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  brandCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },

  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  productRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  productThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  productThumbImage: { width: 40, height: 40 },
  thumbSizeText: { fontSize: 10, fontWeight: '700', color: '#fff' },

  productInfo: { flex: 1 },
  productName: { fontSize: 13, fontWeight: '600', color: '#111827' },
  productSize: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  adminFeeText: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },

  fieldWrap: { alignItems: 'center', gap: 2 },
  fieldLabel: { fontSize: 10, color: '#9CA3AF', fontWeight: '500' },
  inputTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: '#F9FAFB',
    minWidth: 64,
  },
  pesoPrefix: { fontSize: 12, color: '#6B7280', marginRight: 1 },
  fieldInput: {
    fontSize: 13,
    color: '#111827',
    padding: 0,
    minWidth: 36,
    maxWidth: 60,
  },
  saveIndicator: { marginLeft: 3 },

  emptyState: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: H_PADDING,
    paddingBottom: 40,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginTop: 4 },
  emptySubtitle: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
});
