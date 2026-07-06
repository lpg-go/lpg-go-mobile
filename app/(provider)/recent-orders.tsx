import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Card from '../../components/ui/Card';
import DetailHeader from '../../components/ui/DetailHeader';
import EmptyState from '../../components/ui/EmptyState';
import StatusBadge from '../../components/ui/StatusBadge';
import supabase from '../../lib/supabase';
import { colors, radii, spacing, typography } from '../../lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type RecentOrder = {
  id: string;
  status: 'delivered' | 'cancelled';
  total_amount: number;
  created_at: string;
  delivery_address: string;
  itemSummary: string;
};

const H_PADDING = 20;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProviderRecentOrdersScreen() {
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchRecentOrders().then(() => setLoading(false));
  }, []);

  async function fetchRecentOrders() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: orderRows } = await supabase
      .from('orders')
      .select('id, status, total_amount, created_at, delivery_address')
      .eq('selected_provider_id', user.id)
      .in('status', ['delivered', 'cancelled'])
      .order('created_at', { ascending: false });

    if (!orderRows || orderRows.length === 0) {
      setOrders([]);
      return;
    }

    const orderIds = orderRows.map((o) => o.id);
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('order_id, quantity, product:products(name)')
      .in('order_id', orderIds);

    const summaryByOrder: Record<string, string> = {};
    for (const row of itemRows ?? []) {
      const name = (row.product as { name: string } | null)?.name ?? 'Item';
      const part = `${name} x${row.quantity}`;
      summaryByOrder[row.order_id] = summaryByOrder[row.order_id]
        ? `${summaryByOrder[row.order_id]}, ${part}`
        : part;
    }

    setOrders(
      orderRows.map((o) => ({
        id: o.id,
        status: o.status as RecentOrder['status'],
        total_amount: o.total_amount,
        created_at: o.created_at,
        delivery_address: o.delivery_address,
        itemSummary: summaryByOrder[o.id] ?? 'Order',
      }))
    );
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchRecentOrders();
    setRefreshing(false);
  }

  return (
    <View style={styles.screen}>
      <DetailHeader title="Recent Orders" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(provider)'))} />

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
            orders.map((order) => <RecentOrderCard key={order.id} order={order} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Card (mirrors the customer History card) ───────────────────────────────────

function RecentOrderCard({ order }: { order: RecentOrder }) {
  const isCancelled = order.status === 'cancelled';
  const shortId = order.id.slice(-8).toUpperCase();
  const date = new Date(order.created_at).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card
      onPress={() => router.push({ pathname: '/(provider)/active/[id]', params: { id: order.id } })}
      style={[styles.historyCard, isCancelled && styles.historyCardDim]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.historyMeta} numberOfLines={1}>#{shortId} · {date}</Text>
        <StatusBadge
          label={isCancelled ? 'Cancelled' : 'Delivered'}
          tone={isCancelled ? 'danger' : 'success'}
        />
      </View>
      <View style={styles.cardMid}>
        <View style={styles.historyIconSquare}>
          <MaterialCommunityIcons name="gas-cylinder" size={22} color={colors.primary} />
        </View>
        <View style={styles.cardMidText}>
          <Text style={styles.historyProduct} numberOfLines={1}>{order.itemSummary}</Text>
          <View style={styles.addressRow}>
            <Feather name="map-pin" size={12} color={colors.textMuted} />
            <Text style={styles.historyAddress} numberOfLines={1}>{order.delivery_address}</Text>
          </View>
        </View>
      </View>
      <View style={styles.historyBottom}>
        <Text style={styles.historyTotalLabel}>Total</Text>
        <Text style={styles.historyTotalValue}>₱{Number(order.total_amount).toLocaleString()}</Text>
      </View>
    </Card>
  );
}

// ─── Styles (mirror app/(customer)/orders.tsx history card) ─────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg, paddingBottom: 100 },

  emptyPad: { flex: undefined, paddingVertical: spacing.xxxl },

  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardMid: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  cardMidText: { flex: 1 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },

  historyCard: { padding: spacing.lg, marginBottom: spacing.md },
  historyCardDim: { opacity: 0.85 },
  historyMeta: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.textMuted },
  historyIconSquare: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyProduct: { ...typography.cardTitle, color: colors.text },
  historyAddress: { flex: 1, fontSize: 12, color: colors.textMuted },
  historyBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: spacing.md,
  },
  historyTotalLabel: { fontSize: 13, color: colors.textSecondary },
  historyTotalValue: { fontSize: 15, fontWeight: '800', color: colors.text },
});
