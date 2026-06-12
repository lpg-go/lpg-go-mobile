import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import NotificationBell from '../../components/NotificationBell';
import { sendOrderNotification } from '../../lib/notifications';
import supabase from '../../lib/supabase';
import { useAppLogo } from '../../lib/useAppLogo';

// ─── Types ────────────────────────────────────────────────────────────────────

type IncomingOrder = {
  id: string;
  status: 'pending' | 'awaiting_dealer_selection';
  delivery_address: string;
  total_amount: number;
  created_at: string;
  customerName: string;
  itemSummary: string;
  alreadyAccepted: boolean;
};

type RecentOrder = {
  id: string;
  status: 'delivered' | 'cancelled';
  total_amount: number;
  created_at: string;
  itemSummary: string;
};

type ActiveOrder = {
  id: string;
  status: 'in_transit' | 'awaiting_confirmation';
  delivery_address: string;
  total_amount: number;
  customerName: string;
  itemSummary: string;
};

const ACTIVE_STATUS_BADGE: Record<ActiveOrder['status'], { label: string; color: string; bg: string }> = {
  in_transit:            { label: 'On the Way', color: '#16A34A', bg: '#F0FDF4' },
  awaiting_confirmation: { label: 'Delivered?',  color: '#16A34A', bg: '#F0FDF4' },
};

const H_PADDING = 20;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProviderIncomingOrdersScreen() {
  const insets = useSafeAreaInsets();
  const { logoUrl } = useAppLogo();

  const [providerId, setProviderId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [balance, setBalance] = useState(0);
  const [minBalance, setMinBalance] = useState(0);

  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [orders, setOrders] = useState<IncomingOrder[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [stockedProductIds, setStockedProductIds] = useState<string[]>([]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  const providerIdRef = useRef<string | null>(null);
  const stockedProductIdsRef = useRef<string[]>([]);

  useEffect(() => {
    boot();
  }, []);

  // Fetch data whenever providerId is set
  useEffect(() => {
    if (!providerId) return;
    fetchOrders();
    fetchActiveOrders();
    fetchRecentOrders();
  }, [providerId]);

  // Realtime subscription (mount/unmount only)
  useEffect(() => {
    const channel = supabase
      .channel('incoming-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          const isDelete = payload.eventType === 'DELETE';
          const isCancelled = payload.eventType === 'UPDATE' && (payload.new as any)?.status === 'cancelled';
          const isAssigned = payload.eventType === 'UPDATE' && (payload.new as any)?.selected_provider_id !== null;

          if (isDelete || isCancelled || isAssigned) {
            const removedId = isDelete ? (payload.old as any).id : (payload.new as any).id;
            setOrders((prev) => prev.filter((o) => o.id !== removedId));
            // If this provider was the one selected, refresh active orders immediately
            if (isAssigned && (payload.new as any)?.selected_provider_id === providerIdRef.current) {
              fetchActiveOrders();
            }
            return;
          }

          const updated = payload.new as { status?: string; selected_provider_id?: string } | undefined;
          if (
            updated?.status === 'delivered' &&
            updated?.selected_provider_id === providerIdRef.current
          ) {
            Alert.alert('Order Completed!', 'The customer confirmed delivery. Your balance has been updated.');
            const uid = providerIdRef.current;
            if (uid) fetchProfile(uid);
            fetchRecentOrders();
          }

          fetchOrders();
          fetchActiveOrders();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Boot ─────────────────────────────────────────────────────────────────

  async function boot() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    providerIdRef.current = user.id;
    setProviderId(user.id);

    await Promise.all([
      fetchProfile(user.id),
      fetchMinBalance(),
    ]);

    setInitialLoading(false);
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchStockedProducts(uid: string) {
    const { data } = await supabase
      .from('provider_products')
      .select('product_id')
      .eq('provider_id', uid)
      .gt('stock', 0);
    const ids = (data ?? []).map((r) => r.product_id);
    stockedProductIdsRef.current = ids;
    setStockedProductIds(ids);
  }

  async function fetchProfile(uid: string) {
    const { data } = await supabase
      .from('profiles')
      .select('is_online, balance')
      .eq('id', uid)
      .single();
    if (data) {
      setIsOnline(data.is_online);
      setBalance(Number(data.balance));
    }
  }

  async function fetchMinBalance() {
    const { data } = await supabase
      .from('platform_settings')
      .select('min_balance')
      .single();
    if (data) setMinBalance(Number(data.min_balance));
  }

  async function fetchOrders() {
    const uid = providerIdRef.current;
    if (!uid) return;

    // 1. Get stocked product IDs
    const { data: myStockedProducts } = await supabase
      .from('provider_products')
      .select('product_id')
      .eq('provider_id', uid)
      .gt('stock', 0);

    const myStockedProductIds = myStockedProducts?.map((p) => p.product_id) || [];

    console.log('My stocked products:', myStockedProductIds);

    if (myStockedProductIds.length === 0) {
      stockedProductIdsRef.current = [];
      setStockedProductIds([]);
      setOrders([]);
      return;
    }

    stockedProductIdsRef.current = myStockedProductIds;
    setStockedProductIds(myStockedProductIds);

    // 2. Get orders this provider has withdrawn from
    const { data: withdrawn } = await supabase
      .from('order_acceptances')
      .select('order_id')
      .eq('provider_id', uid)
      .not('withdrawn_at', 'is', null);

    const withdrawnIds = (withdrawn ?? []).map((r) => r.order_id);

    // 3. Fetch pending / awaiting orders with their items
    let query = supabase
      .from('orders')
      .select('id, status, delivery_address, total_amount, created_at, customer:profiles!customer_id(full_name), order_items(product_id)')
      .in('status', ['pending', 'awaiting_dealer_selection'])
      .is('selected_provider_id', null)
      .order('created_at', { ascending: false });

    if (withdrawnIds.length > 0) {
      query = query.not('id', 'in', `(${withdrawnIds.join(',')})`);
    }

    const { data: orderRows } = await query;

    console.log('All orders:', orderRows?.length);

    // 4. Filter client-side to orders the provider can fulfill
    const filteredOrders = orderRows?.filter((order) =>
      (order.order_items as { product_id: string }[])?.some((item) =>
        myStockedProductIds.includes(item.product_id)
      )
    ) || [];

    console.log('Filtered orders:', filteredOrders.length);

    if (filteredOrders.length === 0) {
      setOrders([]);
      return;
    }

    const orderIds = filteredOrders.map((o) => o.id);

    // 5. Fetch item summaries for filtered orders
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('order_id, quantity, product:products(name)')
      .in('order_id', orderIds);

    // 6. Fetch provider's acceptances
    const { data: acceptanceRows } = await supabase
      .from('order_acceptances')
      .select('order_id')
      .eq('provider_id', uid)
      .in('order_id', orderIds)
      .is('withdrawn_at', null);

    const acceptedSet = new Set((acceptanceRows ?? []).map((a) => a.order_id));

    const summaryByOrder: Record<string, string> = {};
    for (const row of itemRows ?? []) {
      const name = (row.product as { name: string } | null)?.name ?? 'LPG Gas';
      const part = `${name} x${row.quantity}`;
      summaryByOrder[row.order_id] = summaryByOrder[row.order_id]
        ? `${summaryByOrder[row.order_id]}, ${part}`
        : part;
    }

    setOrders(
      filteredOrders.map((o) => {
        const customer = o.customer as { full_name: string } | null;
        return {
          id: o.id,
          status: o.status as IncomingOrder['status'],
          delivery_address: o.delivery_address,
          total_amount: o.total_amount,
          created_at: o.created_at,
          customerName: customer?.full_name ?? 'New Customer',
          itemSummary: summaryByOrder[o.id] ?? 'LPG Gas',
          alreadyAccepted: acceptedSet.has(o.id),
        };
      })
    );
  }

  async function fetchRecentOrders() {
    const uid = providerIdRef.current;
    if (!uid) return;

    const { data: orderRows } = await supabase
      .from('orders')
      .select('id, status, total_amount, created_at, delivery_address')
      .eq('selected_provider_id', uid)
      .in('status', ['delivered', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(5);

    if (!orderRows || orderRows.length === 0) {
      setRecentOrders([]);
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

    setRecentOrders(
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

  async function fetchActiveOrders() {
    const uid = providerIdRef.current;
    if (!uid) return;

    const { data } = await supabase
      .from('orders')
      .select('id, status, delivery_address, total_amount, customer:profiles!customer_id(full_name), order_items(quantity, product:products(name))')
      .eq('selected_provider_id', uid)
      .in('status', ['in_transit', 'awaiting_confirmation'])
      .order('created_at', { ascending: false });

    if (!data || data.length === 0) { setActiveOrders([]); return; }

    setActiveOrders(
      data.map((row) => {
        const customer = row.customer as { full_name: string } | null;
        const rawItems = (row.order_items ?? []) as { quantity: number; product: { name: string } | null }[];
        const itemSummary = rawItems
          .map((i) => `${i.product?.name ?? 'Item'} x${i.quantity}`)
          .join(', ');
        return {
          id: row.id,
          status: row.status as ActiveOrder['status'],
          delivery_address: row.delivery_address,
          total_amount: row.total_amount,
          customerName: customer?.full_name ?? 'Customer',
          itemSummary,
        };
      })
    );
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleToggleOnline(value: boolean) {
    if (!providerId) return;
    setTogglingOnline(true);
    const { error } = await supabase
      .from('profiles')
      .update({ is_online: value })
      .eq('id', providerId);
    setTogglingOnline(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setIsOnline(value);
    }
  }

  async function handleAccept(orderId: string) {
    if (!providerId) return;

    if (balance < minBalance) {
      Alert.alert(
        'Insufficient Balance',
        `Your balance (₱${balance.toLocaleString()}) is below the minimum required (₱${minBalance.toLocaleString()}). Please top up.`
      );
      return;
    }

    setAccepting(orderId);

    // Verify provider still has stock for at least one item in this order
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('product_id')
      .eq('order_id', orderId);

    const orderProductIds = (orderItems ?? []).map((i) => i.product_id);

    const { data: freshStock } = await supabase
      .from('provider_products')
      .select('product_id')
      .eq('provider_id', providerId)
      .in('product_id', orderProductIds.length > 0 ? orderProductIds : [''])
      .gt('stock', 0);

    if (!freshStock || freshStock.length === 0) {
      setAccepting(null);
      Alert.alert('Out of Stock', 'You no longer have stock for this product.');
      return;
    }

    const { error } = await supabase
      .from('order_acceptances')
      .insert({ order_id: orderId, provider_id: providerId });

    setAccepting(null);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    // Update order status to awaiting_dealer_selection if still pending
    await supabase
      .from('orders')
      .update({ status: 'awaiting_dealer_selection' })
      .eq('id', orderId)
      .eq('status', 'pending');
    // Don't throw if this fails — order may already be awaiting_dealer_selection

    // Notify customer — check acceptance count to pick the right event
    const { count } = await supabase
      .from('order_acceptances')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .is('withdrawn_at', null);

    sendOrderNotification(orderId, (count ?? 0) > 1 ? 'multiple_dealers_accepted' : 'dealer_accepted');

    // Optimistically mark as accepted in local state
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, alreadyAccepted: true } : o))
    );

    // Request location permission now so it's ready for live tracking once selected
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Location Permission Needed',
        'Location access is required to share your position with the customer during delivery. Please enable it in Settings.'
      );
    }
  }

  async function handleRefresh() {
    const uid = providerIdRef.current;
    if (!uid) return;
    setRefreshing(true);
    await Promise.all([
      fetchOrders(),
      fetchActiveOrders(),
      fetchRecentOrders(),
      fetchProfile(uid),
    ]);
    setRefreshing(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (initialLoading) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {logoUrl ? (
          <Image
            source={{ uri: logoUrl }}
            style={styles.headerLogoDynamic}
            resizeMode="contain"
          />
        ) : (
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
        )}
        <View style={styles.onlineRow}>
          <TouchableOpacity
            style={[styles.onlinePill, { backgroundColor: isOnline ? '#DCFCE7' : '#F3F4F6' }]}
            onPress={() => handleToggleOnline(!isOnline)}
            disabled={togglingOnline}
            activeOpacity={0.7}
          >
            {togglingOnline ? (
              <ActivityIndicator size="small" color={isOnline ? PRIMARY : '#9CA3AF'} />
            ) : (
              <>
                <View style={[styles.onlineDot, { backgroundColor: isOnline ? PRIMARY : '#9CA3AF' }]} />
                <Text style={[styles.onlineLabel, { color: isOnline ? PRIMARY : '#9CA3AF' }]}>
                  {isOnline ? 'Online' : 'Offline'}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <NotificationBell href="/(provider)/notifications" />
        </View>
      </View>

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
        {/* Active deliveries + new incoming orders — merged into one section */}
        <View style={styles.section}>
          {/* Active orders — always visible (ongoing deliveries), even when offline */}
          {activeOrders.map((order) => {
            const cfg = ACTIVE_STATUS_BADGE[order.status];
            return (
              <TouchableOpacity
                key={order.id}
                style={[styles.recentCard, styles.activeOrderCard]}
                onPress={() => router.push({ pathname: '/(provider)/active/[id]', params: { id: order.id } })}
                activeOpacity={0.7}
              >
                <View style={styles.recentCardTop}>
                  <Text style={[styles.recentItems, styles.activeOrderText]} numberOfLines={1}>{order.itemSummary}</Text>
                  <View style={[styles.recentBadge, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.recentBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                </View>
                <View style={styles.recentCardBottom}>
                  <Text style={[styles.recentDate, styles.activeOrderAddress]}>{order.delivery_address}</Text>
                  <Text style={[styles.recentAmount, styles.activeOrderText]}>₱{Number(order.total_amount).toLocaleString()}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* New incoming orders — only when online and stocked */}
          {isOnline && stockedProductIds.length > 0 &&
            orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                accepting={accepting === order.id}
                onAccept={() => handleAccept(order.id)}
              />
            ))}

          {/* Empty / status states — shown only when there are no active orders */}
          {activeOrders.length === 0 && (
            !isOnline ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>You're offline</Text>
              </View>
            ) : stockedProductIds.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>
                  Add stock to your products to start receiving orders.
                </Text>
              </View>
            ) : orders.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No Active Orders</Text>
              </View>
            ) : null
          )}
        </View>

        {/* Recent orders */}
        {recentOrders.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recent Orders</Text>
                {recentOrders.map((order) => {
                  const isDelivered = order.status === 'delivered';
                  const shortId = order.id.slice(-8).toUpperCase();
                  const date = new Date(order.created_at).toLocaleString('en-PH', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  });
                  return (
                    <TouchableOpacity
                      key={order.id}
                      style={styles.recentCard}
                      onPress={() => router.push({ pathname: '/(provider)/active/[id]', params: { id: order.id } })}
                      activeOpacity={0.7}
                    >
                      <View style={styles.recentCardTop}>
                        <Text style={styles.recentItems} numberOfLines={1}>{order.itemSummary}</Text>
                        <View style={[
                          styles.recentBadge,
                          { backgroundColor: isDelivered ? '#16A34A' : '#DC2626' },
                        ]}>
                          <Text style={[
                            styles.recentBadgeText,
                            { color: '#FFFFFF' },
                          ]}>
                            {isDelivered ? 'Delivered' : 'Cancelled'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.recentCardBottom}>
                        <Text style={styles.recentDate} numberOfLines={1}>{order.delivery_address}</Text>
                        <Text style={styles.recentAmount}>₱{Number(order.total_amount).toLocaleString()}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({
  order,
  accepting,
  onAccept,
}: {
  order: IncomingOrder;
  accepting: boolean;
  onAccept: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.recentCard, styles.newOrderCard]}
      activeOpacity={0.7}
      onPress={() => {
        Alert.alert(
          'Accept Order?',
          `Location: ${order.delivery_address}`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Accept', onPress: onAccept },
          ]
        );
      }}
      disabled={accepting || order.alreadyAccepted}
    >
      <View style={styles.recentCardTop}>
        <Text style={styles.recentItems} numberOfLines={1}>{order.itemSummary}</Text>
        {accepting ? (
          <ActivityIndicator size="small" color={PRIMARY} />
        ) : (
          <Text style={styles.recentAmount}>₱{Number(order.total_amount).toLocaleString()}</Text>
        )}
      </View>
      <View style={styles.recentCardBottom}>
        <Text style={styles.recentDate}>{order.delivery_address}</Text>
      </View>
      {order.alreadyAccepted && (
        <View style={styles.acceptedCheck}>
          <ActivityIndicator size="small" color={PRIMARY} />
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PADDING,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  headerLogo: {
    width: 90,
    height: 36,
  },
  headerLogoDynamic: {
    width: 140,
    height: 56,
  },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    minHeight: 30,
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineLabel: { fontSize: 13, fontWeight: '600' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 16, paddingBottom: 32 },

  // Section
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  viewAllText: { fontSize: 13, fontWeight: '600', color: PRIMARY },

  // Recent order card
  recentCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  newOrderCard: {
    backgroundColor: '#F0FDF4',
    borderColor: PRIMARY,
  },
  acceptedCheck: {
    position: 'absolute',
    bottom: 10,
    right: 12,
  },
  activeOrderCard: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  activeOrderText: { color: '#fff' },
  activeOrderAddress: { color: 'rgba(255,255,255,0.85)' },
  recentCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  recentBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  recentBadgeText: { fontSize: 11, fontWeight: '600' },
  recentItems: { fontSize: 13, fontWeight: '600', color: '#111827', flex: 1 },
  recentCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  recentDate: { fontSize: 12, color: '#6B7280', flex: 1 },
  orderCustomerLine: { fontSize: 12, color: '#6B7280', marginBottom: 6 },
  recentAmount: { fontSize: 13, fontWeight: '700', color: '#111827', flexShrink: 0 },

  // Incoming order card — same shape as activeCard, white background
  // Empty state
  emptyState: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
});
