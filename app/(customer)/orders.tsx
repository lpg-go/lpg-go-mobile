import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
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

import Card from '../../components/ui/Card';
import FloatingPillNav from '../../components/ui/FloatingPillNav';
import StatusBadge from '../../components/ui/StatusBadge';
import { colors, radii, spacing, typography } from '../../lib/theme';
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
  const params = useLocalSearchParams<{ tab?: string }>();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'active' | 'history'>(
    params.tab === 'history' ? 'history' : 'active'
  );

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
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const activeOrders = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const recentOrders = orders.filter((o) => !ACTIVE_STATUSES.includes(o.status));
  const list = tab === 'active' ? activeOrders : recentOrders;

  return (
    <View style={styles.screen}>
      {/* Dark header + segmented toggle */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.headerTitle}>My Orders</Text>
        <View style={styles.toggle}>
          {(['active', 'history'] as const).map((t) => {
            const on = tab === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.segment, on && styles.segmentOn]}
                onPress={() => setTab(t)}
                activeOpacity={0.8}
              >
                <Text style={[styles.segmentText, on ? styles.segmentTextOn : styles.segmentTextOff]}>
                  {t === 'active' ? 'Active' : 'History'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
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
        {list.length === 0 ? (
          tab === 'active' ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No active orders</Text>
              <TouchableOpacity
                style={styles.browseButton}
                onPress={() => router.replace('/(customer)')}
              >
                <Text style={styles.browseButtonText}>Browse brands</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No past orders yet</Text>
            </View>
          )
        ) : (
          list.map((order) => <OrderCard key={order.id} order={order} />)
        )}
      </ScrollView>

      <FloatingPillNav
        active="orders"
        onNavigate={(t) => {
          if (t === 'home') router.replace('/(customer)');
          else setTab('active');
        }}
      />
    </View>
  );
}

function OrderCard({ order }: { order: OrderRow }) {
  const cfg = STATUS_CONFIG[order.status];
  const isActive = ACTIVE_STATUSES.includes(order.status);
  const isCancelled = order.status === 'cancelled';
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

  if (isActive) {
    return (
      <TouchableOpacity style={styles.activeCard} onPress={onPress} activeOpacity={0.85}>
        <View style={styles.cardTop}>
          <Text style={styles.activeMeta} numberOfLines={1}>#{shortId} · {date}</Text>
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>{cfg.label}</Text>
          </View>
        </View>
        <View style={styles.cardMid}>
          <View style={styles.activeIconSquare}>
            <MaterialCommunityIcons name="gas-cylinder" size={22} color="#fff" />
          </View>
          <View style={styles.cardMidText}>
            <Text style={styles.activeProduct} numberOfLines={1}>{itemSummary}</Text>
            <View style={styles.addressRow}>
              <Feather name="map-pin" size={12} color="rgba(255,255,255,0.75)" />
              <Text style={styles.activeAddress} numberOfLines={1}>{order.delivery_address}</Text>
            </View>
          </View>
        </View>
        <View style={styles.activeBottom}>
          <Text style={styles.activeTotalLabel}>Total</Text>
          <Text style={styles.activeTotalValue}>₱{Number(order.total_amount).toLocaleString()}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <Card
      onPress={onPress}
      style={[styles.historyCard, isCancelled && styles.historyCardDim]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.historyMeta} numberOfLines={1}>#{shortId} · {date}</Text>
        <StatusBadge label={cfg.label} tone={isCancelled ? 'danger' : 'success'} />
      </View>
      <View style={styles.cardMid}>
        <View style={styles.historyIconSquare}>
          <MaterialCommunityIcons name="gas-cylinder" size={22} color={colors.primary} />
        </View>
        <View style={styles.cardMidText}>
          <Text style={styles.historyProduct} numberOfLines={1}>{itemSummary}</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Dark header + toggle
  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerTitle: { ...typography.title, color: colors.headerText, marginBottom: spacing.md },
  toggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radii.md,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  segmentOn: { backgroundColor: colors.card },
  segmentText: { fontSize: 14, fontWeight: '600' },
  segmentTextOn: { color: colors.headerBg },
  segmentTextOff: { color: colors.headerSubtext },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg, paddingBottom: 100 },

  // Empty state
  emptyState: { paddingVertical: 48, alignItems: 'center', gap: spacing.md },
  emptyTitle: { fontSize: 14, color: colors.textMuted },
  browseButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  browseButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  // Shared card layout
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

  // Active card (solid green)
  activeCard: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  activeMeta: { flex: 1, fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  activeBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    flexShrink: 0,
  },
  activeBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  activeIconSquare: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeProduct: { fontSize: 15, fontWeight: '700', color: '#fff' },
  activeAddress: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  activeBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    paddingTop: spacing.md,
  },
  activeTotalLabel: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  activeTotalValue: { fontSize: 15, fontWeight: '800', color: '#fff' },

  // History card (white)
  historyCard: {
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
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
