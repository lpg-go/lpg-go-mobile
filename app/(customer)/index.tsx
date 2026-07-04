import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import HeaderDark from '../../components/ui/HeaderDark';
import AddressBar from '../../components/ui/AddressBar';
import SearchBar from '../../components/ui/SearchBar';
import BrandCard from '../../components/ui/BrandCard';
import FloatingPillNav from '../../components/ui/FloatingPillNav';
import { colors, spacing, radii, typography } from '../../lib/theme';
import supabase from '../../lib/supabase';

type Brand = {
  id: string;
  name: string;
  logo_url: string | null;
  is_preferred: boolean;
  productCount: number;
  hasActiveProviders: boolean;
};

const H_PADDING = 18;
const GRID_GAP = 8;
const COLS = 3;

// Fetches the signed-in user's name + avatar for the dark header. Mirrors the
// profile fetch in components/HeaderAvatar.tsx.
function useProfileHeader() {
  const [fullName, setFullName] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('avatar_url, full_name')
        .eq('id', user.id)
        .single();
      if (!alive || !data) return;
      if (data.full_name) setFullName(data.full_name);
      if (data.avatar_url) setAvatarUrl(data.avatar_url);
    })();
    return () => { alive = false; };
  }, []);

  return { fullName, avatarUrl };
}

export default function CustomerHomeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { fullName, avatarUrl } = useProfileHeader();

  const [brands, setBrands] = useState<Brand[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Size cards for exactly COLS columns off the window width: subtract the
  // container's horizontal padding (both sides) and the inter-card gaps, then
  // divide. Floor so rounding never pushes the row total past the container and
  // wraps a card to the next line. => (width - 36 - 16) / 3
  const cardWidth = Math.floor(
    (width - H_PADDING * 2 - GRID_GAP * (COLS - 1)) / COLS
  );

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
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Green fills the status-bar notch above the header */}
        <View style={{ height: insets.top, backgroundColor: colors.headerBg }} />

        {/* Header */}
        <HeaderDark
          name={fullName}
          avatarUrl={avatarUrl}
          onBellPress={() => router.push('/(customer)/notifications')}
          onAvatarPress={() => router.push('/(customer)/profile')}
        >
          {/* TODO: wire real delivery address + GPS location picker (feature pending) */}
          <AddressBar address="Set delivery address" onPress={() => {}} />
        </HeaderDark>

        {/* Search — overlaps the header's extra bottom padding */}
        <View style={styles.searchWrap}>
          <SearchBar
            placeholder="Search for a brand"
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Section header */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Brands</Text>
          {/* TODO: "See all" — dedicated all-brands screen not built yet */}
          <TouchableOpacity onPress={() => {}} activeOpacity={0.7}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>

        {/* Brands grid */}
        <View style={styles.gridSection}>
          {loading ? (
            <SkeletonGrid cardWidth={cardWidth} />
          ) : filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="inbox" size={40} color={colors.textFaint} />
              <Text style={styles.emptyText}>No brands available</Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {filtered.map((brand, index) => (
                <View key={brand.id} style={{ width: cardWidth }}>
                  <BrandCard
                    name={brand.name}
                    imageUrl={brand.logo_url}
                    index={index}
                    isFeatured={brand.is_preferred}
                    onPress={() =>
                      router.push({
                        pathname: '/(customer)/brand/[id]',
                        params: { id: brand.id, name: brand.name },
                      })
                    }
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating bottom nav */}
      <FloatingPillNav
        active="home"
        onNavigate={(tab) => {
          if (tab === 'orders') router.push('/(customer)/orders');
          // TODO: History screen not built yet — routes to Orders for now
          else if (tab === 'history') router.push('/(customer)/orders');
          // home → already here
        }}
      />
    </View>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonGrid({ cardWidth }: { cardWidth: number }) {
  return (
    <View style={styles.grid}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <View key={i} style={[styles.skeletonCard, { width: cardWidth }]}>
          <View style={styles.skeletonLogo} />
          <View style={styles.skeletonName} />
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },

  // Search — pulled up to overlap the header's 46px bottom padding
  searchWrap: {
    paddingHorizontal: H_PADDING,
    marginTop: -30,
  },

  // Section header
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PADDING,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.sectionHeader,
    color: colors.text,
  },
  seeAll: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },

  // Grid
  gridSection: { paddingHorizontal: H_PADDING },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },

  // Skeleton
  skeletonCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  skeletonLogo: { height: 72, backgroundColor: '#E5E7EB' },
  skeletonName: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5E7EB',
    margin: spacing.md,
  },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { ...typography.body, color: colors.textMuted },
});
