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

import AppHeader from '../../components/AppHeader';
import CustomerHeaderActions from '../../components/CustomerHeaderActions';
import supabase from '../../lib/supabase';

type OrderStatus =
  | 'pending'
  | 'awaiting_dealer_selection'
  | 'in_transit'
  | 'awaiting_confirmation'
  | 'delivered'
  | 'cancelled';

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  pending:                   { label: 'Select Provider',  color: '#16A34A', bg: '#F0FDF4' },
  awaiting_dealer_selection: { label: 'Finding Provider', color: '#16A34A', bg: '#F0FDF4' },
  in_transit:                { label: 'On the Way',      color: '#16A34A', bg: '#F0FDF4' },
  awaiting_confirmation:     { label: 'Awaiting Confirmation', color: '#16A34A', bg: '#F0FDF4' },
  delivered:                 { label: 'Delivered',        color: '#FFFFFF', bg: '#16A34A' },
  cancelled:                 { label: 'Cancelled',        color: '#FFFFFF', bg: '#DC2626' },
};

type OrderRow = {
  id: string;
  status: OrderStatus;
  total_amount: number;
  created_at: string;
  delivery_address: string;
  firstItemName: string;
  firstItemProductId: string | null;
  extraCount: number;
};

// In-progress statuses — everything before delivered/cancelled
const ACTIVE_STATUSES: OrderStatus[] = [
  'pending',
  'awaiting_dealer_selection',
  'in_transit',
  'awaiting_confirmation',
];

const H_PADDING = 20;

export default function CustomerOrdersScreen() {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchOrders().then(() => setLoading(false));
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      channel = supabase
        .channel(`customer-orders-${user.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders', filter: `customer_id=eq.${user.id}` },
          (payload) => {
            const updated = payload.new as { id: string; status: OrderStatus };
            setOrders((prev) =>
              prev.map((o) => o.id === updated.id ? { ...o, status: updated.status } : o)
            );
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders', filter: `customer_id=eq.${user.id}` },
          () => { fetchOrders(); }
        )
        .subscribe();
    });

    return () => { if (channel) supabase.removeChannel(channel); };
  }, [fetchOrders]);

  const fetchOrders = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: orderRows } = await supabase
      .from('orders')
      .select('id, status, total_amount, created_at, delivery_address')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false });

    if (!orderRows || orderRows.length === 0) {
      setOrders([]);
      return;
    }

    const orderIds = orderRows.map((o) => o.id);

    // Fetch items per order for the summary label + first product id (for routing)
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('order_id, product_id, product:products(name)')
      .in('order_id', orderIds);

    // Group by order_id
    const itemsByOrder: Record<string, string[]> = {};
    const firstProductIdByOrder: Record<string, string> = {};
    for (const row of itemRows ?? []) {
      const name = (row.product as { name: string } | null)?.name ?? 'Item';
      if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
      itemsByOrder[row.order_id].push(name);
      if (!firstProductIdByOrder[row.order_id] && row.product_id) {
        firstProductIdByOrder[row.order_id] = row.product_id;
      }
    }

    setOrders(
      orderRows.map((o) => {
        const names = itemsByOrder[o.id] ?? [];
        return {
          id: o.id,
          status: o.status as OrderStatus,
          total_amount: o.total_amount,
          created_at: o.created_at,
          delivery_address: o.delivery_address,
          firstItemName: names[0] ?? 'Order',
          firstItemProductId: firstProductIdByOrder[o.id] ?? null,
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

  const activeOrders = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const recentOrders = orders.filter((o) => !ACTIVE_STATUSES.includes(o.status));

  return (
    <View style={styles.screen}>
      <AppHeader
        showLogo
        right={<CustomerHeaderActions />}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
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
        {/* Active orders — always visible (ongoing deliveries) */}
        {activeOrders.length === 0 ? (
          <View style={styles.cardEmptyState}>
            <Text style={styles.cardEmptyText}>No Active Orders</Text>
          </View>
        ) : (
          activeOrders.map((order) => <OrderCard key={order.id} order={order} />)
        )}

        {recentOrders.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
              Recent Orders
            </Text>
            {recentOrders.map((order) => <OrderCard key={order.id} order={order} />)}
          </>
        )}

        {orders.length === 0 && (
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => router.replace('/(customer)')}
          >
            <Text style={styles.browseButtonText}>Browse Brands</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function OrderCard({ order }: { order: OrderRow }) {
  const cfg = STATUS_CONFIG[order.status];
  const isActive = ACTIVE_STATUSES.includes(order.status);
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
      style={[styles.card, isActive && styles.activeCard]}
      onPress={() => {
        if (order.status === 'awaiting_dealer_selection' && order.firstItemProductId) {
          // Resume the bidding view for an order still finding a provider
          router.push({
            pathname: '/(customer)/find-store/[productId]',
            params: { productId: order.firstItemProductId, resumeOrderId: order.id },
          });
        } else {
          router.push({ pathname: '/(customer)/order/[id]', params: { id: order.id } });
        }
      }}
      activeOpacity={0.7}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.itemSummary, isActive && styles.activeText]} numberOfLines={1}>{itemSummary}</Text>
        <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>

      <View style={styles.cardBottom}>
        <Text style={[styles.address, isActive && styles.activeAddress]} numberOfLines={1}>{order.delivery_address}</Text>
        <Text style={[styles.amount, isActive && styles.activeText]}>₱{Number(order.total_amount).toLocaleString()}</Text>
      </View>
    </TouchableOpacity>
  );
}

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 16, paddingBottom: 32 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },
  sectionTitleSpaced: { marginTop: 18 },

  cardEmptyState: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmptyText: { fontSize: 13, color: '#9CA3AF' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  activeCard: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  activeText: { color: '#fff' },
  activeAddress: { color: 'rgba(255,255,255,0.85)' },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  statusText: { fontSize: 11, fontWeight: '600' },
  itemSummary: { fontSize: 13, fontWeight: '600', color: '#111827', flex: 1 },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  address: { fontSize: 12, color: '#6B7280', flex: 1 },
  amount: { fontSize: 13, fontWeight: '700', color: '#111827', flexShrink: 0 },

  browseButton: {
    alignSelf: 'center',
    marginTop: 16,
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 24,
  },
  browseButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
