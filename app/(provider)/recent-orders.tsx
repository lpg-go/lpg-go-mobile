import { Feather } from '@expo/vector-icons';
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
import { colors, spacing, typography } from '../../lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type RecentOrder = {
  id: string;
  status: 'delivered' | 'cancelled';
  total_amount: number;
  created_at: string;
  delivery_address: string;
  itemSummary: string;
  rating: number | null;
  comment: string | null;
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
    const [{ data: itemRows }, { data: reviewRows }] = await Promise.all([
      supabase
        .from('order_items')
        .select('order_id, quantity, product:products(name)')
        .in('order_id', orderIds),
      supabase
        .from('reviews')
        .select('order_id, rating, comment')
        .in('order_id', orderIds),
    ]);

    const summaryByOrder: Record<string, string> = {};
    for (const row of itemRows ?? []) {
      const name = (row.product as { name: string } | null)?.name ?? 'Item';
      const part = `${name} x${row.quantity}`;
      summaryByOrder[row.order_id] = summaryByOrder[row.order_id]
        ? `${summaryByOrder[row.order_id]}, ${part}`
        : part;
    }

    const reviewByOrder: Record<string, { rating: number; comment: string | null }> = {};
    for (const row of reviewRows ?? []) {
      reviewByOrder[row.order_id] = { rating: row.rating, comment: row.comment };
    }

    setOrders(
      orderRows.map((o) => ({
        id: o.id,
        status: o.status as RecentOrder['status'],
        total_amount: o.total_amount,
        created_at: o.created_at,
        delivery_address: o.delivery_address,
        itemSummary: summaryByOrder[o.id] ?? 'Order',
        rating: reviewByOrder[o.id]?.rating ?? null,
        comment: reviewByOrder[o.id]?.comment ?? null,
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

  return (
    <Card
      onPress={() => router.push({ pathname: '/(provider)/active/[id]', params: { id: order.id, from: 'recent-orders' } })}
      style={[styles.historyCard, isCancelled && styles.historyCardDim]}
    >
      <View style={styles.productRow}>
        <Text style={styles.historyProduct} numberOfLines={1}>{order.itemSummary}</Text>
        <StatusBadge
          label={isCancelled ? 'Cancelled' : 'Delivered'}
          tone={isCancelled ? 'danger' : 'success'}
        />
      </View>
      <View style={styles.addressRow}>
        <Feather name="map-pin" size={12} color={colors.textMuted} />
        <Text style={styles.historyAddress} numberOfLines={1}>{order.delivery_address}</Text>
        <Text style={styles.historyTotalValue}>₱{Number(order.total_amount).toLocaleString()}</Text>
      </View>

      {!isCancelled && order.rating != null && (
        <View style={styles.reviewRow}>
          <View style={styles.reviewStars}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Feather
                key={s}
                name="star"
                size={13}
                color={s <= order.rating! ? colors.amber : colors.border}
              />
            ))}
          </View>
          {order.comment ? (
            <Text style={styles.reviewComment} numberOfLines={1}>"{order.comment}"</Text>
          ) : null}
        </View>
      )}
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

  productRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },

  historyCard: { padding: spacing.lg, marginBottom: spacing.md },
  historyCardDim: { opacity: 0.85 },
  historyProduct: { ...typography.cardTitle, color: colors.text, flex: 1 },
  historyAddress: { flex: 1, fontSize: 12, color: colors.textMuted },
  historyTotalValue: { fontSize: 15, fontWeight: '800', color: colors.text, marginLeft: spacing.sm },

  // Customer review (delivered orders that have been reviewed)
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.grey100,
  },
  reviewStars: { flexDirection: 'row', gap: 2 },
  reviewComment: { flex: 1, fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
});
