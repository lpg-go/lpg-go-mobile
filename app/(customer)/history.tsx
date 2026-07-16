import { Feather } from '@expo/vector-icons';
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

import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import FloatingPillNav from '../../components/ui/FloatingPillNav';
import StatusBadge from '../../components/ui/StatusBadge';
import { colors, spacing, typography } from '../../lib/theme';
import supabase from '../../lib/supabase';
import { useActiveOrderCount } from '../../lib/useActiveOrderCount';

type HistoryOrder = {
  id: string;
  status: 'delivered' | 'cancelled';
  total_amount: number;
  created_at: string;
  delivery_address: string;
  firstItemName: string;
  extraCount: number;
};

const H_PADDING = 20;

export default function CustomerHistoryScreen() {
  const insets = useSafeAreaInsets();
  const activeOrderCount = useActiveOrderCount();
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: orderRows } = await supabase
      .from('orders')
      .select('id, status, total_amount, created_at, delivery_address')
      .eq('customer_id', user.id)
      .in('status', ['delivered', 'cancelled'])
      .order('created_at', { ascending: false });

    if (!orderRows || orderRows.length === 0) {
      setOrders([]);
      return;
    }

    const orderIds = orderRows.map((o) => o.id);
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('order_id, product:products(name)')
      .in('order_id', orderIds);

    const itemsByOrder: Record<string, string[]> = {};
    for (const row of itemRows ?? []) {
      const name = row.product?.name ?? 'Item';
      if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
      itemsByOrder[row.order_id].push(name);
    }

    setOrders(
      orderRows.map((o) => {
        const names = itemsByOrder[o.id] ?? [];
        return {
          id: o.id,
          status: o.status as HistoryOrder['status'],
          total_amount: o.total_amount,
          created_at: o.created_at,
          delivery_address: o.delivery_address,
          firstItemName: names[0] ?? 'Order',
          extraCount: Math.max(0, names.length - 1),
        };
      })
    );
  }, []);

  useEffect(() => {
    fetchOrders().then(() => setLoading(false));
  }, [fetchOrders]);

  // Refresh when an order transitions into a terminal state.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    // Guards the unmount-before-getUser-resolves race: without it, cleanup sees
    // a null channel and the late subscribe leaks one that is never removed.
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return;
      channel = supabase
        .channel(`customer-history-${user.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders', filter: `customer_id=eq.${user.id}` },
          () => { fetchOrders(); }
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.headerTitle}>Order History</Text>
      </View>

      {loading ? (
        <View style={[styles.screen, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
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
          {orders.length === 0 ? (
            <EmptyState
              icon="clock"
              message="No past orders yet"
              subtitle="Your completed orders will appear here."
              style={styles.emptyPad}
            />
          ) : (
            orders.map((order) => <HistoryOrderCard key={order.id} order={order} />)
          )}
        </ScrollView>
      )}

      <FloatingPillNav
        tabs={[
          { key: 'home', label: 'Home', icon: 'home' },
          { key: 'orders', label: 'Orders', icon: 'package', badgeCount: activeOrderCount },
          { key: 'history', label: 'History', icon: 'clock' },
        ]}
        activeKey="history"
        onNavigate={(t) => {
          if (t === 'home') router.replace('/(customer)');
          else if (t === 'orders') router.push('/(customer)/orders');
          // history → already here
        }}
      />
    </View>
  );
}

function HistoryOrderCard({ order }: { order: HistoryOrder }) {
  const isCancelled = order.status === 'cancelled';
  const itemSummary =
    order.extraCount > 0 ? `${order.firstItemName} and ${order.extraCount} more` : order.firstItemName;

  return (
    <Card
      onPress={() => router.push({ pathname: '/(customer)/order/[id]', params: { id: order.id, from: 'history' } })}
      style={[styles.historyCard, isCancelled && styles.historyCardDim]}
    >
      <View style={styles.productRow}>
        <Text style={styles.historyProduct} numberOfLines={1}>{itemSummary}</Text>
        <StatusBadge label={isCancelled ? 'Cancelled' : 'Delivered'} tone={isCancelled ? 'danger' : 'success'} />
      </View>
      <View style={styles.addressRow}>
        <Feather name="map-pin" size={12} color={colors.textMuted} />
        <Text style={styles.historyAddress} numberOfLines={1}>{order.delivery_address}</Text>
        <Text style={styles.historyTotalValue}>₱{Number(order.total_amount).toLocaleString()}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerTitle: { ...typography.title, color: colors.headerText },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg, paddingBottom: 100 },

  emptyPad: { flex: undefined, paddingVertical: spacing.xxxl },

  productRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },

  historyCard: { padding: spacing.lg, marginBottom: spacing.md },
  historyCardDim: { opacity: 0.85 },
  historyProduct: { ...typography.cardTitle, color: colors.text, flex: 1 },
  historyAddress: { flex: 1, fontSize: 12, color: colors.textMuted },
  historyTotalValue: { fontSize: 15, fontWeight: '800', color: colors.text, marginLeft: spacing.sm },
});
