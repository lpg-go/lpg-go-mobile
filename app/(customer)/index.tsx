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

import AppHeader from '../../components/AppHeader';
import CustomerHeaderActions from '../../components/CustomerHeaderActions';
import supabase from '../../lib/supabase';

type Brand = {
  id: string;
  name: string;
  logo_url: string | null;
  is_preferred: boolean;
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

  const [brands, setBrands] = useState<Brand[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);

  // Always lay out COLS columns, sized to the grid's measured width (falls back
  // to the window width before the first layout pass). Floor so rounding never
  // pushes the row total past the container and wraps a card to the next line.
  const availWidth = gridWidth > 0 ? gridWidth : width - H_PADDING * 2;
  const cardWidth = Math.floor((availWidth - GRID_GAP * (COLS - 1)) / COLS);

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
      .select('id, name, logo_url, is_preferred')
      .eq('is_active', true)
      // Preferred brand sorts LAST: booleans order false < true, so ascending
      // puts non-preferred (false) first and the preferred brand at the bottom.
      .order('is_preferred', { ascending: true })
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
      .eq('is_available', true);

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
        is_preferred: b.is_preferred ?? false,
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
        {/* Header */}
        <AppHeader
          variant="inline"
          showLogo
          logoHref="/(customer)"
          noHorizontalPadding
          right={<CustomerHeaderActions />}
        />

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
        <View onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
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
        </View>
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
      style={[styles.gridCard, { width: cardWidth, height: cardWidth }]}
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
      <Text
        style={[styles.gridBrandName, !hasActiveProviders && styles.gridBrandNameUnavailable]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {brand.name}
      </Text>
      {brand.is_preferred && (
        <View style={styles.preferredBadge}>
          <Feather name="star" size={9} color="#92400E" style={styles.preferredBadgeIcon} />
          <Text style={styles.preferredBadgeText}>Preferred</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonGrid({ cardWidth }: { cardWidth: number }) {
  return (
    <View style={styles.grid}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <View key={i} style={[styles.gridCard, styles.skeletonCard, { width: cardWidth, height: cardWidth }]}>
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

  // Grid card — square (height set to cardWidth inline)
  gridCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },

  // Logo — fixed 64x64 reserved block
  logoWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  logoImage: { width: 64, height: 64, borderRadius: 8 },
  logoFallback: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitials: { fontSize: 20, fontWeight: '700', color: '#fff' },

  // Brand name — single line, fixed slot
  gridBrandName: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    lineHeight: 16,
    height: 16,
    alignSelf: 'stretch',
  },
  gridBrandNameUnavailable: { color: '#9CA3AF' },

  // Preferred badge — top-right, overlapping the logo corner
  preferredBadge: {
    position: 'absolute',
    top: 12,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    zIndex: 2,
  },
  preferredBadgeIcon: { marginRight: 3 },
  preferredBadgeText: { fontSize: 9, fontWeight: '700', color: '#92400E' },

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
