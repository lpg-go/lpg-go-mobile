import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BrandProductImage from '../../components/ui/BrandProductImage';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import FloatingPillNav from '../../components/ui/FloatingPillNav';
import supabase from '../../lib/supabase';
import { brandTints, colors, radii, spacing } from '../../lib/theme';

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
  is_available: boolean;
  admin_fee: number;
};

type BrandGroup = {
  brand_name: string;
  logo_url: string | null;
  products: ProviderProduct[];
};

type SaveState = 'idle' | 'saving' | 'saved';

const H_PADDING = 20;

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
        is_available,
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
        is_available: row.is_available,
        admin_fee: Number(row.product.admin_fee),
      }));

    setProducts(rows);

    if (!collapsedInitialized.current && rows.length > 0) {
      setCollapsedBrands(new Set());
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

  function handleAvailabilityChange(id: string, newValue: boolean) {
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, is_available: newValue } : p));
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

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.headerTitle}>My Products</Text>
      <Text style={styles.headerSubtitle}>Set price + availability per item</Text>
    </View>
  );

  const nav = (
    <FloatingPillNav
      tabs={[
        { key: 'home', label: 'Home', icon: 'home' },
        { key: 'products', label: 'Products', icon: 'package' },
      ]}
      activeKey="products"
      onNavigate={(key) => {
        if (key === 'home') router.replace('/(provider)');
        // products → already here
      }}
    />
  );

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}

      {products.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          <EmptyState icon="box" message="No products available" subtitle="Pull down to refresh." />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {brandGroups.map((group, gi) => {
            const collapsed = collapsedBrands.has(group.brand_name);
            const tint = brandTints[gi % brandTints.length];
            const sellingCount = group.products.filter((p) => p.is_available).length;
            return (
              <Card key={group.brand_name} style={styles.brandCard}>
                <TouchableOpacity
                  style={styles.brandHeaderRow}
                  onPress={() => toggleBrand(group.brand_name)}
                  activeOpacity={0.7}
                >
                  <BrandProductImage
                    url={group.logo_url}
                    size={40}
                    borderRadius={radii.sm}
                    resizeMode="contain"
                    iconSize={22}
                    iconColor={tint.icon}
                    backgroundColor={tint.bg}
                  />
                  <Text style={styles.brandHeader} numberOfLines={1}>{group.brand_name}</Text>
                  {sellingCount > 0 ? (
                    <View style={styles.sellingBadge}>
                      <Text style={styles.sellingBadgeText}>{sellingCount} selling</Text>
                    </View>
                  ) : (
                    <View style={styles.offBadge}>
                      <Text style={styles.offBadgeText}>Off</Text>
                    </View>
                  )}
                  <Feather name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {!collapsed && (
                  <View style={styles.productsWrap}>
                    {group.products.map((product, index) => (
                      <ProductRow
                        key={product.id}
                        product={product}
                        isLast={index === group.products.length - 1}
                        onPriceChange={(v) => handlePriceChange(product.id, v)}
                        onAvailabilityChange={(v) => handleAvailabilityChange(product.id, v)}
                      />
                    ))}
                  </View>
                )}
              </Card>
            );
          })}
        </ScrollView>
      )}

      {nav}
    </View>
  );
}

// ─── Product row ──────────────────────────────────────────────────────────────

function ProductRow({
  product,
  isLast,
  onPriceChange,
  onAvailabilityChange,
}: {
  product: ProviderProduct;
  isLast: boolean;
  onPriceChange: (v: number) => void;
  onAvailabilityChange: (v: boolean) => void;
}) {
  const [priceText, setPriceText] = useState(String(product.price));
  const [priceSave, setPriceSave] = useState<SaveState>('idle');
  const [available, setAvailable] = useState(product.is_available);
  const [toggleSaving, setToggleSaving] = useState(false);

  // Sync local state when parent refreshes data from Realtime
  useEffect(() => { setPriceText(String(product.price)); }, [product.price]);
  useEffect(() => { setAvailable(product.is_available); }, [product.is_available]);
  const priceRef = useRef<TextInput>(null);

  async function savePrice() {
    const parsed = parseFloat(priceText);
    if (isNaN(parsed) || parsed < 0) {
      setPriceText(String(product.price));
      return;
    }
    // An already-live product can't be zeroed out — it would violate the DB
    // constraint chk_available_requires_price (is_available => price > 0).
    if (available && parsed <= 0) {
      Alert.alert('Invalid price', 'Available products must have a price greater than ₱0.');
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

  // Toggle saves immediately (no blur). Optimistic update with revert on error.
  async function toggleAvailable(next: boolean) {
    // Enabling requires a price > 0 (DB constraint chk_available_requires_price).
    // Turning off is always allowed. Check the current price before writing so
    // the provider never hits the raw constraint error.
    if (next) {
      const current = parseFloat(priceText);
      if (isNaN(current) || current <= 0) {
        Alert.alert('Set a price first', 'Please set a price before making this product available.');
        setAvailable(false);
        return;
      }
    }
    setAvailable(next);
    setToggleSaving(true);
    const { error } = await supabase
      .from('provider_products')
      .update({ is_available: next })
      .eq('id', product.id);
    setToggleSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      setAvailable(!next);
      return;
    }
    onAvailabilityChange(next);
  }

  return (
    <View style={[styles.productRow, !isLast && styles.productRowBorder]}>
      {/* Top: size + admin fee · availability toggle */}
      <View style={styles.rowTop}>
        <View style={styles.rowTopLeft}>
          <Text style={styles.sizeText}>{product.size_kg} kg</Text>
          <Text style={styles.adminFeeText}>Admin fee ₱{product.admin_fee.toLocaleString()}</Text>
        </View>
        <Switch
          value={available}
          onValueChange={toggleAvailable}
          disabled={toggleSaving}
          trackColor={{ false: colors.grey300, true: colors.primary }}
          thumbColor="#fff"
          ios_backgroundColor={colors.grey300}
        />
      </View>

      {/* Price field — always editable so a provider can set a price while the
          product is OFF, then enable "Selling" (which requires price > 0). */}
      <TouchableOpacity
        style={styles.priceField}
        onPress={() => priceRef.current?.focus()}
        activeOpacity={1}
      >
        <Text style={styles.pesoPrefix}>₱</Text>
        <TextInput
          ref={priceRef}
          style={styles.priceInput}
          value={priceText}
          onChangeText={setPriceText}
          placeholder="Set price"
          placeholderTextColor={colors.textFaint}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onBlur={savePrice}
          onSubmitEditing={savePrice}
          selectTextOnFocus
        />
        {priceSave === 'saving' && <ActivityIndicator size="small" color={colors.textMuted} />}
        {priceSave === 'saved' && <Feather name="check" size={16} color={colors.primary} />}
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: colors.headerText },
  headerSubtitle: { fontSize: 13, color: colors.headerSubtext, marginTop: 2 },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg, paddingBottom: 100 },

  // Brand group card
  brandCard: { marginBottom: spacing.md, overflow: 'hidden' },
  brandHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  brandLogo: { width: 40, height: 40, borderRadius: radii.sm },
  brandIconSquare: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandHeader: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  sellingBadge: {
    backgroundColor: colors.primaryTint,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  sellingBadgeText: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  offBadge: {
    backgroundColor: colors.grey100,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  offBadgeText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },

  // Product rows
  productsWrap: { borderTopWidth: 1, borderTopColor: colors.grey100 },
  productRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  productRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.grey100 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowTopLeft: { flex: 1 },
  sizeText: { fontSize: 15, fontWeight: '500', color: colors.text },
  adminFeeText: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  priceField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.sm,
    backgroundColor: colors.grey50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pesoPrefix: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  priceInput: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, padding: 0 },

  // Empty state
  emptyState: { flexGrow: 1, paddingHorizontal: H_PADDING, paddingBottom: 40 },
});
