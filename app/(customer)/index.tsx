import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

type Brand = {
  id: string;
  name: string;
  productCount: number;
};

export default function CustomerHomeScreen() {
  const insets = useSafeAreaInsets();

  const [brands, setBrands] = useState<Brand[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    await fetchBrands();
    setLoading(false);
  }


  async function fetchBrands() {
    const { data: brandRows } = await supabase
      .from('brands')
      .select('id, name')
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

    setBrands(
      brandRows.map((b) => ({
        id: b.id,
        name: b.name,
        productCount: countByBrand[b.id] ?? 0,
      }))
    );
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchData();
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
      >
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
          <SkeletonList />
        ) : filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="inbox" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>No brands available</Text>
          </View>
        ) : (
          filtered.map((brand) => (
            <BrandCard
              key={brand.id}
              brand={brand}
              onPress={() =>
                router.push({
                  pathname: '/(customer)/brand/[id]',
                  params: { id: brand.id, name: brand.name },
                })
              }
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function BrandCard({
  brand,
  onPress,
}: {
  brand: Brand;
  onPress: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <Text style={styles.brandName}>{brand.name}</Text>
        <Text style={styles.productCount}>
          {brand.productCount} {brand.productCount === 1 ? 'product' : 'products'} available
        </Text>
      </View>
      <TouchableOpacity style={styles.orderButton} onPress={onPress}>
        <Text style={styles.orderButtonText}>Order Now</Text>
      </TouchableOpacity>
      <Feather name="chevron-right" size={20} color="#D1D5DB" style={styles.chevron} />
    </View>
  );
}

function SkeletonList() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonTitle} />
          <View style={styles.skeletonSubtitle} />
          <ActivityIndicator
            size="small"
            color="#E5E7EB"
            style={styles.skeletonSpinner}
          />
        </View>
      ))}
    </>
  );
}

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },


  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
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
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },

  // Section
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },

  // Brand card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  cardBody: { flex: 1 },
  brandName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 3,
  },
  productCount: {
    fontSize: 13,
    color: '#6B7280',
  },
  orderButton: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  orderButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  chevron: { marginLeft: 2 },

  // Skeleton
  skeletonCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#F9FAFB',
  },
  skeletonTitle: {
    height: 16,
    width: '50%',
    backgroundColor: '#E5E7EB',
    borderRadius: 6,
    marginBottom: 8,
  },
  skeletonSubtitle: {
    height: 12,
    width: '35%',
    backgroundColor: '#E5E7EB',
    borderRadius: 6,
  },
  skeletonSpinner: {
    position: 'absolute',
    right: 16,
    top: '50%',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
  },
});
