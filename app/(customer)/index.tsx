import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import supabase from '../../lib/supabase';
import { useAppLogo } from '../../lib/useAppLogo';

type Brand = {
  id: string;
  name: string;
  logo_url: string | null;
  productCount: number;
  hasActiveProviders: boolean;
};

const PRIMARY = '#16A34A';
const H_PADDING = 20;
const GRID_GAP = 10;
const COLS = 3;

const AVATAR_COLORS = ['#16A34A', '#2563EB', '#D97706', '#7C3AED', '#DC2626', '#0891B2'];

function getBrandColor(name: string): string {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export default function CustomerHomeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { logoUrl } = useAppLogo();

  const [brands, setBrands] = useState<Brand[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const cardWidth = (width - H_PADDING * 2 - GRID_GAP * (COLS - 1)) / COLS;

  // Refetch brands on every screen focus so logo updates and new brands appear immediately
  useFocusEffect(
    useCallback(() => {
      fetchBrands().then(() => setLoading(false));
      return () => {};
    }, [])
  );


  async function fetchBrands() {
    const { data: brandRows } = await supabase
      .from('brands')
      .select('id, name, logo_url')
      .eq('is_active', true)
      .order('name');

    if (!brandRows) return;

    const { data: productRows } = await supabase
      .from('products')
      .select('id, brand_id')
      .eq('is_active', true);

    const countByBrand: Record<string, number> = {};
    for (const p of productRows ?? []) {
      countByBrand[p.brand_id] = (countByBrand[p.brand_id] ?? 0) + 1;
    }

    const productIds = (productRows ?? []).map((p) => p.id);
    const { data: activeProviderRows } = await supabase
      .from('provider_products')
      .select('product_id, provider:profiles!provider_products_provider_id_fkey(is_online, is_approved)')
      .in('product_id', productIds.length > 0 ? productIds : [''])
      .gt('stock', 0);

    const activeBrandIds = new Set<string>();
    for (const pp of activeProviderRows ?? []) {
      if (pp.provider?.is_online === true && pp.provider?.is_approved === true) {
        const product = (productRows ?? []).find((p) => p.id === pp.product_id);
        if (product) activeBrandIds.add(product.brand_id);
      }
    }

    setBrands(
      brandRows.map((b) => ({
        id: b.id,
        name: b.name,
        logo_url: b.logo_url ?? null,
        productCount: countByBrand[b.id] ?? 0,
        hasActiveProviders: activeBrandIds.has(b.id),
      }))
    );
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchBrands();
    setRefreshing(false);
  }

  const filtered = brands.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={PRIMARY}
            colors={[PRIMARY]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header logo */}
        {logoUrl ? (
          <Image
            source={{ uri: logoUrl }}
            style={styles.headerLogoDynamic}
            resizeMode="contain"
          />
        ) : (
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
        )}

        {/* Search */}
        <View style={styles.searchRow}>
          <Feather name="search" size={16} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search LPG brands..."
            placeholderTextColor="#9CA3AF"
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />
        </View>

        {/* Brands section */}
        <Text style={styles.sectionTitle}>Available Brands</Text>

        {loading ? (
          <SkeletonGrid cardWidth={cardWidth} />
        ) : filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="inbox" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>No brands available</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {filtered.map((brand) => (
              <BrandGridCard
                key={brand.id}
                brand={brand}
                cardWidth={cardWidth}
                onPress={() =>
                  router.push({
                    pathname: '/(customer)/brand/[id]',
                    params: { id: brand.id, name: brand.name },
                  })
                }
                hasActiveProviders={brand.hasActiveProviders}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Brand grid card ──────────────────────────────────────────────────────────

function BrandGridCard({
  brand,
  cardWidth,
  onPress,
  hasActiveProviders,
}: {
  brand: Brand;
  cardWidth: number;
  onPress: () => void;
  hasActiveProviders: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.gridCard, { width: cardWidth }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.logoWrap}>
        {brand.logo_url ? (
          <Image
            source={{ uri: brand.logo_url }}
            style={styles.logoImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.logoFallback}>
            <Text style={styles.logoInitials}>{getInitials(brand.name)}</Text>
          </View>
        )}
        {!hasActiveProviders && (
          <View style={styles.unavailableOverlay}>
            <Text style={styles.unavailableOverlayText}>Unavailable</Text>
          </View>
        )}
      </View>
      <Text style={[styles.gridBrandName, !hasActiveProviders && styles.gridBrandNameUnavailable]} numberOfLines={2}>
        {brand.name}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonGrid({ cardWidth }: { cardWidth: number }) {
  return (
    <View style={styles.grid}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <View key={i} style={[styles.gridCard, styles.skeletonCard, { width: cardWidth }]}>
          <View style={styles.skeletonLogo} />
          <View style={styles.skeletonName} />
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingBottom: 32 },

  // Header logo
  headerLogo: {
    width: 120,
    height: 48,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  headerLogoDynamic: {
    width: 200,
    height: 80,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
    marginBottom: 20,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: '#111827', padding: 0 },

  // Section title
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 12 },

  // Grid container
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },

  // Grid card
  gridCard: {
    height: 120,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 10,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },

  // Logo
  logoWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoImage: { width: 80, height: 80, borderRadius: 8 },
  logoFallback: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitials: { fontSize: 22, fontWeight: '700', color: '#fff' },

  // Brand name
  gridBrandName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
    lineHeight: 15,
  },
  gridBrandNameUnavailable: { color: '#9CA3AF' },

  // Unavailable overlay
  unavailableOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableOverlayText: { fontSize: 9, fontWeight: '700', color: '#fff', textAlign: 'center' },

  // Skeleton
  skeletonCard: { backgroundColor: '#F9FAFB', borderColor: '#F3F4F6' },
  skeletonLogo: { width: 80, height: 80, borderRadius: 8, backgroundColor: '#E5E7EB' },
  skeletonName: { width: '60%', height: 10, borderRadius: 5, backgroundColor: '#E5E7EB' },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: '#9CA3AF' },
});
