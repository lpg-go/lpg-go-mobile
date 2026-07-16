import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ActiveDeliveryCard from '../../components/order/ActiveDeliveryCard';
import EmptyState from '../../components/ui/EmptyState';
import FloatingPillNav from '../../components/ui/FloatingPillNav';
import { colors, spacing, typography } from '../../lib/theme';
import supabase from '../../lib/supabase';
import { useActiveOrderCount } from '../../lib/useActiveOrderCount';

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
  const activeOrderCount = useActiveOrderCount();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
      const name = row.product?.name ?? 'Item';
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

  async function handleRefresh() {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const activeOrders = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.headerTitle}>Active Orders</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
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
        {activeOrders.length === 0 ? (
          <EmptyState
            icon="package"
            message="No active orders"
            subtitle="Your ongoing orders will appear here."
            style={styles.emptyPad}
          />
        ) : (
          activeOrders.map((order) => <OrderCard key={order.id} order={order} />)
        )}
      </ScrollView>

      <FloatingPillNav
        tabs={[
          { key: 'home', label: 'Home', icon: 'home' },
          { key: 'orders', label: 'Orders', icon: 'package', badgeCount: activeOrderCount },
          { key: 'history', label: 'History', icon: 'clock' },
        ]}
        activeKey="orders"
        onNavigate={(t) => {
          if (t === 'home') router.replace('/(customer)');
          else if (t === 'history') router.push('/(customer)/history');
          // orders → already here
        }}
      />
    </View>
  );
}

function OrderCard({ order }: { order: OrderRow }) {
  const cfg = STATUS_CONFIG[order.status];
  const itemSummary =
    order.extraCount > 0
      ? `${order.firstItemName} and ${order.extraCount} more`
      : order.firstItemName;

  // PRESERVED EXACTLY — resume bidding for orders still finding a provider,
  // otherwise open the order detail.
  const onPress = () => {
    if (order.status === 'awaiting_dealer_selection' && order.firstItemProductId) {
      router.push({
        pathname: '/(customer)/find-store/[productId]',
        params: { productId: order.firstItemProductId, resumeOrderId: order.id },
      });
    } else {
      router.push({ pathname: '/(customer)/order/[id]', params: { id: order.id } });
    }
  };

  return (
    <ActiveDeliveryCard
      itemSummary={itemSummary}
      statusLabel={cfg.label}
      address={order.delivery_address}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Dark header
  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerTitle: { ...typography.title, color: colors.headerText },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg, paddingBottom: 100 },

  // Empty state
  emptyPad: { flex: undefined, paddingVertical: spacing.xxxl },
});
