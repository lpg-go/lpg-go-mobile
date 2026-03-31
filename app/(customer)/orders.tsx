import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import supabase from '../../lib/supabase';

type OrderStatus =
  | 'pending'
  | 'awaiting_dealer_selection'
  | 'in_transit'
  | 'awaiting_confirmation'
  | 'delivered'
  | 'cancelled';

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  pending:                   { label: 'Waiting...',       color: '#6B7280', bg: '#F3F4F6' },
  awaiting_dealer_selection: { label: 'Finding Provider', color: '#D97706', bg: '#FEF3C7' },
  in_transit:                { label: 'On the Way!',      color: '#2563EB', bg: '#DBEAFE' },
  awaiting_confirmation:     { label: 'Delivered?',       color: '#7C3AED', bg: '#EDE9FE' },
  delivered:                 { label: 'Delivered',        color: '#16A34A', bg: '#DCFCE7' },
  cancelled:                 { label: 'Cancelled',        color: '#DC2626', bg: '#FEE2E2' },
};

type OrderRow = {
  id: string;
  status: OrderStatus;
  total_amount: number;
  created_at: string;
  firstItemName: string;
  extraCount: number;
};

const H_PADDING = 20;

export default function CustomerOrdersScreen() {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchOrders().then(() => setLoading(false));
  }, []);

  const fetchOrders = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: orderRows } = await supabase
      .from('orders')
      .select('id, status, total_amount, created_at')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false });

    if (!orderRows || orderRows.length === 0) {
      setOrders([]);
      return;
    }

    const orderIds = orderRows.map((o) => o.id);

    // Fetch one item per order for the summary label
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('order_id, product:products(name)')
      .in('order_id', orderIds);

    // Group by order_id
    const itemsByOrder: Record<string, string[]> = {};
    for (const row of itemRows ?? []) {
      const name = (row.product as { name: string } | null)?.name ?? 'Item';
      if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
      itemsByOrder[row.order_id].push(name);
    }

    setOrders(
      orderRows.map((o) => {
        const names = itemsByOrder[o.id] ?? [];
        return {
          id: o.id,
          status: o.status as OrderStatus,
          total_amount: o.total_amount,
          created_at: o.created_at,
          firstItemName: names[0] ?? 'Order',
          extraCount: Math.max(0, names.length - 1),
        };
      })
    );
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }

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
        <Text style={styles.headerTitle}>My Orders</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          orders.length === 0 && styles.scrollEmpty,
        ]}
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
        {orders.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="package" size={48} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No orders yet</Text>
            <Text style={styles.emptySubtitle}>Your order history will appear here</Text>
            <TouchableOpacity
              style={styles.browseButton}
              onPress={() => router.replace('/(customer)')}
            >
              <Text style={styles.browseButtonText}>Browse Brands</Text>
            </TouchableOpacity>
          </View>
        ) : (
          orders.map((order) => <OrderCard key={order.id} order={order} />)
        )}
      </ScrollView>
    </View>
  );
}

function OrderCard({ order }: { order: OrderRow }) {
  const cfg = STATUS_CONFIG[order.status];
  const shortId = order.id.slice(-8).toUpperCase();
  const date = new Date(order.created_at).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const itemSummary =
    order.extraCount > 0
      ? `${order.firstItemName} and ${order.extraCount} more`
      : order.firstItemName;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        router.push({ pathname: '/(customer)/order/[id]', params: { id: order.id } })
      }
      activeOpacity={0.7}
    >
      <View style={styles.cardTop}>
        <Text style={styles.orderId}>#{shortId}</Text>
        <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>

      <Text style={styles.itemSummary} numberOfLines={1}>{itemSummary}</Text>

      <View style={styles.cardBottom}>
        <Text style={styles.date}>{date}</Text>
        <Text style={styles.amount}>₱{Number(order.total_amount).toLocaleString()}</Text>
      </View>
    </TouchableOpacity>
  );
}

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingHorizontal: H_PADDING,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 16, paddingBottom: 32 },
  scrollEmpty: { flex: 1 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  orderId: { fontSize: 13, fontWeight: '700', color: '#111827' },
  statusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '600' },
  itemSummary: { fontSize: 13, color: '#6B7280', marginBottom: 10 },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  date: { fontSize: 12, color: '#9CA3AF' },
  amount: { fontSize: 14, fontWeight: '700', color: PRIMARY },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingBottom: 40,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginTop: 4 },
  emptySubtitle: { fontSize: 14, color: '#9CA3AF' },
  browseButton: {
    marginTop: 8,
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 24,
  },
  browseButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
