import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
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
  id: string;           // provider_products.id
  product_id: string;
  product_name: string;
  size_kg: number;
  brand_name: string;
  logo_url: string | null;
  image_url: string | null;
  price: number;
  stock: number;
};

type EditState = {
  price: string;
  stock: string;
};

type BrandGroup = {
  brand_name: string;
  logo_url: string | null;
  products: ProviderProduct[];
};

const AVATAR_COLORS = ['#16A34A', '#2563EB', '#D97706', '#7C3AED', '#DC2626', '#0891B2'];
function getBrandColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}
function getInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

const H_PADDING = 20;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProviderProductsScreen() {
  const insets = useSafeAreaInsets();

  const [products, setProducts] = useState<ProviderProduct[]>([]);
  const [editMap, setEditMap] = useState<Record<string, EditState>>({});
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collapsedBrands, setCollapsedBrands] = useState<Set<string>>(new Set());
  const collapsedInitialized = useRef(false);

  useFocusEffect(
    useCallback(() => {
      fetchProducts().finally(() => setLoading(false));

      // Realtime: re-fetch when any provider_products row changes for this provider
      let channel: ReturnType<typeof supabase.channel> | null = null;
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        channel = supabase
          .channel('provider_products_changes')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'provider_products',
              filter: `provider_id=eq.${user.id}`,
            },
            () => fetchProducts()
          )
          .subscribe();
      });

      return () => {
        if (channel) supabase.removeChannel(channel);
      };
    }, [])
  );

  // ── Data ──────────────────────────────────────────────────────────────────

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
        is_available,
        product:products (
          name,
          size_kg,
          image_url,
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
      }));

    setProducts(rows);

    // On first load: open only the first brand, collapse the rest
    if (!collapsedInitialized.current && rows.length > 0) {
      const sortedBrands = [...new Set(rows.map((r) => r.brand_name))].sort();
      setCollapsedBrands(new Set(sortedBrands.slice(1)));
      collapsedInitialized.current = true;
    }

    // Rebuild edit map preserving any unsaved changes when refreshing
    setEditMap((prev) => {
      const next: Record<string, EditState> = {};
      for (const r of rows) {
        next[r.id] = prev[r.id] ?? {
          price: String(r.price),
          stock: String(r.stock),
        };
      }
      return next;
    });
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchProducts().finally(() => setRefreshing(false));
  }

  // ── Edit helpers ──────────────────────────────────────────────────────────

  function handleEnterEditMode() {
    // Reset edit map to current DB values when entering edit mode
    const fresh: Record<string, EditState> = {};
    for (const p of products) {
      fresh[p.id] = { price: String(p.price), stock: String(p.stock) };
    }
    setEditMap(fresh);
    setEditMode(true);
  }

  function handleCancelEdit() {
    setEditMode(false);
  }

  function setField(id: string, field: keyof EditState, value: string) {
    setEditMap((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  // ── Save changes ──────────────────────────────────────────────────────────

  async function handleSave() {
    // Collect rows with changed price or stock
    const changed = products.filter((p) => {
      const e = editMap[p.id];
      if (!e) return false;
      const newPrice = parseFloat(e.price);
      const newStock = parseInt(e.stock, 10);
      return (
        (!isNaN(newPrice) && newPrice !== p.price) ||
        (!isNaN(newStock) && newStock !== p.stock)
      );
    });

    // Validate
    for (const p of changed) {
      const e = editMap[p.id];
      const price = parseFloat(e.price);
      const stock = parseInt(e.stock, 10);
      if (isNaN(price) || price < 0) {
        Alert.alert('Validation Error', `Invalid price for ${p.product_name}.`);
        return;
      }
      if (isNaN(stock) || stock < 0) {
        Alert.alert('Validation Error', `Invalid stock for ${p.product_name}.`);
        return;
      }
    }

    if (changed.length === 0) { setEditMode(false); return; }

    setSaving(true);

    // Run sequentially to avoid overwhelming React Native's fetch
    for (const p of changed) {
      const { error } = await supabase
        .from('provider_products')
        .update({
          price: parseFloat(editMap[p.id].price),
          stock: parseInt(editMap[p.id].stock, 10),
        })
        .eq('id', p.id);

      if (error) {
        setSaving(false);
        Alert.alert('Save Error', error.message);
        return;
      }
    }

    setSaving(false);

    // Apply locally so UI updates without a full refetch
    setProducts((prev) =>
      prev.map((p) => {
        const e = editMap[p.id];
        if (!e) return p;
        return {
          ...p,
          price: parseFloat(e.price),
          stock: parseInt(e.stock, 10),
        };
      })
    );

    setEditMode(false);
  }

  function toggleBrand(brandName: string) {
    setCollapsedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brandName)) next.delete(brandName);
      else next.add(brandName);
      return next;
    });
  }

  // ── Group by brand ────────────────────────────────────────────────────────

  const brandGroups: BrandGroup[] = [];
  for (const p of products) {
    const group = brandGroups.find((g) => g.brand_name === p.brand_name);
    if (group) {
      group.products.push(p);
    } else {
      brandGroups.push({ brand_name: p.brand_name, logo_url: p.logo_url, products: [p] });
    }
  }
  brandGroups.sort((a, b) => a.brand_name.localeCompare(b.brand_name));

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Products</Text>
          {editMode ? (
            <TouchableOpacity onPress={handleCancelEdit} hitSlop={8}>
              <Text style={styles.cancelEditText}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleEnterEditMode} hitSlop={8}>
              <Feather name="edit-2" size={20} color={PRIMARY} />
            </TouchableOpacity>
          )}
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
          <>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: editMode ? 100 : 32 },
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor={PRIMARY}
                  colors={[PRIMARY]}
                />
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
                      {/* Brand logo */}
                      {group.logo_url ? (
                        <Image source={{ uri: group.logo_url }} style={styles.brandLogo} resizeMode="contain" />
                      ) : (
                        <View style={styles.brandLogoFallback}>
                          <Text style={styles.brandLogoInitials}>{getInitials(group.brand_name)}</Text>
                        </View>
                      )}
                      <Text style={styles.brandHeader}>{group.brand_name}</Text>
                      <Feather
                        name={collapsed ? 'chevron-down' : 'chevron-up'}
                        size={16}
                        color="#9CA3AF"
                      />
                    </TouchableOpacity>
                    {!collapsed && (
                      <View style={styles.brandCard}>
                        {group.products.map((product, index) => (
                          <ProductRow
                            key={product.id}
                            product={product}
                            editState={editMap[product.id]}
                            editMode={editMode}
                            isLast={index === group.products.length - 1}
                            onChangePrice={(val) => setField(product.id, 'price', val)}
                            onChangeStock={(val) => setField(product.id, 'stock', val)}
                          />

                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Save bar */}
            {editMode && (
              <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}>
                <TouchableOpacity
                  style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Product row ──────────────────────────────────────────────────────────────

function ProductRow({
  product,
  editState,
  editMode,
  isLast,
  onChangePrice,
  onChangeStock,
}: {
  product: ProviderProduct;
  editState: EditState | undefined;
  editMode: boolean;
  isLast: boolean;
  onChangePrice: (val: string) => void;
  onChangeStock: (val: string) => void;
}) {
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

      {/* Left: name + size */}
      <View style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={1}>{product.product_name}</Text>
        <Text style={styles.productSize}>{product.size_kg}kg</Text>
      </View>

      {editMode && editState ? (
        /* Edit mode: price + stock inputs */
        <View style={styles.editFields}>
          <View style={styles.editFieldWrap}>
            <Text style={styles.editFieldLabel}>Price</Text>
            <View style={styles.editInputWrap}>
              <Text style={styles.pesoSign}>₱</Text>
              <TextInput
                style={styles.editInput}
                value={editState.price}
                onChangeText={onChangePrice}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
            </View>
          </View>
          <View style={styles.editFieldWrap}>
            <Text style={styles.editFieldLabel}>Stock</Text>
            <TextInput
              style={[styles.editInput, styles.editInputStock]}
              value={editState.stock}
              onChangeText={onChangeStock}
              keyboardType="number-pad"
              selectTextOnFocus
            />
          </View>
        </View>
      ) : (
        /* View mode: price + stock */
        <View style={styles.viewFields}>
          <Text style={styles.priceText}>₱{product.price.toLocaleString()}</Text>
          <Text style={[
            styles.stockText,
            product.stock === 0 ? styles.stockRed :
            product.stock <= 10 ? styles.stockOrange :
            styles.stockGreen,
          ]}>
            {product.stock === 0 ? 'Out of Stock' : product.stock <= 10 ? `Only ${product.stock} left` : `${product.stock} in stock`}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Header
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
  cancelEditText: { fontSize: 14, fontWeight: '600', color: '#EF4444' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 16 },

  // Brand section
  brandSection: { marginBottom: 20 },
  brandHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingVertical: 2,
  },
  brandLogo: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  brandLogoFallback: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#16A34A',
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

  // Product row
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
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  productThumbImage: { width: 40, height: 40 },
  thumbSizeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  productInfo: { flex: 1 },
  productName: { fontSize: 13, fontWeight: '600', color: '#111827' },
  productSize: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },

  // View mode fields
  viewFields: { alignItems: 'flex-end', marginRight: 12 },
  priceText: { fontSize: 13, fontWeight: '700', color: '#111827' },
  stockText: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  stockGreen: { color: '#16A34A' },
  stockOrange: { color: '#D97706' },
  stockRed: { color: '#EF4444' },

  // Edit mode fields
  editFields: {
    flexDirection: 'row',
    gap: 8,
    marginRight: 10,
  },
  editFieldWrap: { alignItems: 'center' },
  editFieldLabel: { fontSize: 10, color: '#9CA3AF', marginBottom: 3 },
  editInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: '#F9FAFB',
    width: 80,
  },
  pesoSign: { fontSize: 12, color: '#6B7280', marginRight: 2 },
  editInput: {
    fontSize: 13,
    color: '#111827',
    padding: 0,
    flex: 1,
    minWidth: 0,
  },
  editInputStock: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#F9FAFB',
    width: 54,
    textAlign: 'center',
  },

  // Save bar
  saveBar: {
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
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Empty state
  emptyState: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: H_PADDING,
    paddingBottom: 40,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginTop: 4 },
  emptySubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
});
