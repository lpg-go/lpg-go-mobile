import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import ActiveDeliveryCard from '../../components/order/ActiveDeliveryCard';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import FloatingPillNav from '../../components/ui/FloatingPillNav';
import IdentityHeader from '../../components/ui/IdentityHeader';
import StatCard from '../../components/ui/StatCard';
import StatusBadge from '../../components/ui/StatusBadge';
import ConfirmModal from '../../components/ui/ConfirmModal';
import StatusToggle from '../../components/ui/StatusToggle';
import { sendOrderNotification } from '../../lib/notifications';
import supabase from '../../lib/supabase';
import { colors, radii, spacing } from '../../lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type IncomingOrder = {
  id: string;
  status: 'pending' | 'awaiting_dealer_selection';
  delivery_address: string;
  total_amount: number;
  is_express: boolean;
  created_at: string;
  customerName: string;
  itemSummary: string;
  sizeSummary: string | null;
  alreadyAccepted: boolean;
};

type ActiveOrder = {
  id: string;
  status: 'in_transit' | 'awaiting_confirmation';
  delivery_address: string;
  total_amount: number;
  customerName: string;
  itemSummary: string;
};

const ACTIVE_STATUS_LABEL: Record<ActiveOrder['status'], string> = {
  in_transit: 'On the Way',
  awaiting_confirmation: 'Awaiting',
};

const H_PADDING = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProviderIncomingOrdersScreen() {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [balance, setBalance] = useState(0);
  const [minBalance, setMinBalance] = useState(0);

  // Header identity
  const [providerName, setProviderName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [providerType, setProviderType] = useState<'dealer' | 'rider' | null>(null);
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [togglingOnline, setTogglingOnline] = useState(false);

  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [orders, setOrders] = useState<IncomingOrder[]>([]);
  const [availableProductIds, setAvailableProductIds] = useState<string[]>([]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [confirmOrderId, setConfirmOrderId] = useState<string | null>(null); // order awaiting accept-confirmation

  const providerIdRef = useRef<string | null>(null);
  const availableProductIdsRef = useRef<string[]>([]);
  const providerTypeRef = useRef<'dealer' | 'rider' | null>(null);

  useEffect(() => {
    boot();
  }, []);

  // Fetch data whenever providerId is set
  useEffect(() => {
    if (!providerId) return;
    fetchOrders();
    fetchActiveOrders();
  }, [providerId]);

  // Re-sync online status (and balance) whenever the screen regains focus — e.g.
  // after toggling availability on the Profile screen — so order gating stays correct.
  useFocusEffect(
    useCallback(() => {
      const uid = providerIdRef.current;
      if (uid) fetchProfile(uid);
    }, [])
  );

  // Safety-net polling for the RLS-blinded selection case: once a customer picks
  // another provider, selected_provider_id is set to them and non-selected
  // providers lose SELECT on the row — so Supabase Realtime never delivers that
  // UPDATE here and the realtime handler can't remove it. Refetch on focus, then
  // poll every 12s while online + focused. fetchOrders filters
  // selected_provider_id IS NULL, so any order taken by someone else drops out on
  // the next tick. Interval is cleared on blur/unmount/going offline.
  useFocusEffect(
    useCallback(() => {
      if (!providerIdRef.current) return;
      fetchOrders();
      if (!isOnline) return;
      const interval = setInterval(() => { fetchOrders(); }, 12000);
      return () => clearInterval(interval);
    }, [isOnline])
  );

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

  async function fetchProfile(uid: string) {
    const { data } = await supabase
      .from('profiles')
      .select('is_online, balance, full_name, avatar_url, provider_type, display_id')
      .eq('id', uid)
      .single();
    if (data) {
      setIsOnline(data.is_online);
      setBalance(Number(data.balance));
      setProviderName(data.full_name ?? '');
      setAvatarUrl(data.avatar_url ?? null);
      const nextType = (data.provider_type as 'dealer' | 'rider' | null) ?? null;
      providerTypeRef.current = nextType;
      setProviderType(nextType);
      setDisplayId(data.display_id ?? null);
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

    // 1. Get product IDs this provider has enabled for selling
    const { data: myAvailableProducts } = await supabase
      .from('provider_products')
      .select('product_id')
      .eq('provider_id', uid)
      .eq('is_available', true);

    const myAvailableProductIds = myAvailableProducts?.map((p) => p.product_id) || [];

    if (myAvailableProductIds.length === 0) {
      availableProductIdsRef.current = [];
      setAvailableProductIds([]);
      setOrders([]);
      return;
    }

    availableProductIdsRef.current = myAvailableProductIds;
    setAvailableProductIds(myAvailableProductIds);

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
      .select('id, status, delivery_address, total_amount, is_express, created_at, customer:profiles!customer_id(full_name), order_items(product_id)')
      .in('status', ['pending', 'awaiting_dealer_selection'])
      .is('selected_provider_id', null)
      // Express orders surface first (priority handling), then newest-first.
      .order('is_express', { ascending: false })
      .order('created_at', { ascending: false });

    if (withdrawnIds.length > 0) {
      query = query.not('id', 'in', `(${withdrawnIds.join(',')})`);
    }

    const { data: orderRows } = await query;

    // 4. Filter client-side to orders the provider can fulfill (has an
    //    enabled listing for at least one of the ordered products).
    //    Dealers additionally never see express orders — accept_order blocks
    //    them server-side, so they must not surface in the incoming list at all.
    const isDealer = providerTypeRef.current === 'dealer';
    const filteredOrders = orderRows?.filter((order) => {
      if (isDealer && order.is_express) return false;
      return (order.order_items as { product_id: string }[])?.some((item) =>
        myAvailableProductIds.includes(item.product_id)
      );
    }) || [];

    if (filteredOrders.length === 0) {
      setOrders([]);
      return;
    }

    const orderIds = filteredOrders.map((o) => o.id);

    // 5. Fetch item summaries for filtered orders
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('order_id, quantity, product:products(name, size_kg)')
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
    const sizeByOrder: Record<string, string> = {};
    for (const row of itemRows ?? []) {
      const product = row.product;
      const name = product?.name ?? 'LPG Gas';
      const part = `${name} x${row.quantity}`;
      summaryByOrder[row.order_id] = summaryByOrder[row.order_id]
        ? `${summaryByOrder[row.order_id]}, ${part}`
        : part;
      // Representative cylinder size for the card's size tag (first sized item).
      if (!sizeByOrder[row.order_id] && product?.size_kg != null) {
        sizeByOrder[row.order_id] = `${product.size_kg}kg`;
      }
    }

    setOrders(
      filteredOrders.map((o) => {
        const customer = o.customer;
        return {
          id: o.id,
          status: o.status as IncomingOrder['status'],
          delivery_address: o.delivery_address,
          total_amount: o.total_amount,
          is_express: Boolean(o.is_express),
          created_at: o.created_at,
          customerName: customer?.full_name ?? 'New Customer',
          itemSummary: summaryByOrder[o.id] ?? 'LPG Gas',
          sizeSummary: sizeByOrder[o.id] ?? null,
          alreadyAccepted: acceptedSet.has(o.id),
        };
      })
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
        const customer = row.customer;
        const rawItems = row.order_items ?? [];
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
    const uid = providerIdRef.current;
    if (!uid) return;
    setTogglingOnline(true);
    const { error } = await supabase
      .from('profiles')
      .update({ is_online: value })
      .eq('id', uid);
    setTogglingOnline(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setIsOnline(value);
  }

  function handleAccept(orderId: string) {
    if (!providerId) return;

    if (balance < minBalance) {
      Alert.alert(
        'Insufficient Balance',
        `Your balance (₱${balance.toLocaleString()}) is below the minimum required (₱${minBalance.toLocaleString()}). Please top up.`
      );
      return;
    }

    // Open the styled confirmation popup; actual accept runs on confirm.
    setConfirmOrderId(orderId);
  }

  async function acceptOrder(orderId: string) {
    // handleAccept guards on providerId before opening the confirm modal, but this
    // runs from the modal's onConfirm and is not covered by that check.
    if (!providerId) return;

    setConfirmOrderId(null);
    setAccepting(orderId);

    // Re-verify the provider still has an enabled listing for at least one item
    // in this order (guards the race where availability was toggled off after
    // the list was fetched). If none, silently hide the order — don't accept.
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('product_id')
      .eq('order_id', orderId);

    const orderProductIds = (orderItems ?? []).map((i) => i.product_id);

    const { data: freshAvailable } = await supabase
      .from('provider_products')
      .select('product_id')
      .eq('provider_id', providerId)
      .in('product_id', orderProductIds.length > 0 ? orderProductIds : [''])
      .eq('is_available', true);

    if (!freshAvailable || freshAvailable.length === 0) {
      setAccepting(null);
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      return;
    }

    const { error } = await supabase.rpc('accept_order', { p_order_id: orderId });

    setAccepting(null);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

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
      fetchProfile(uid),
    ]);
    setRefreshing(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (initialLoading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Incoming broadcast cards are visible only when online AND at least one product
  // is enabled — the core gating that must not change.
  const showIncoming = isOnline && availableProductIds.length > 0;

  return (
    <View style={styles.screen}>
      {/* ── Dark header ─────────────────────────────────────────────── */}
      <IdentityHeader
        name={providerName || 'Provider'}
        avatarUrl={avatarUrl}
        onAvatarPress={() => router.push('/(provider)/profile')}
        right={
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push('/(provider)/notifications')}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="bell" size={20} color={colors.headerText} />
          </TouchableOpacity>
        }
      >
        {/* Stat cards */}
        <View style={styles.statRow}>
          {/* Balance card — mirrors the Status card structure so the top-up
              button lands at the same size/position as the status toggle. */}
          <StatCard
            label="Balance"
            value={balance.toLocaleString()}
            right={
              <TouchableOpacity
                style={styles.balanceTopUpBtn}
                onPress={() => router.push('/(provider)/topup' as never)}
                activeOpacity={0.8}
                hitSlop={8}
              >
                <Feather name="plus" size={16} color="#fff" />
              </TouchableOpacity>
            }
          />
          <StatCard
            label="Status"
            value={
              <View style={styles.statusValueRow}>
                <View
                  style={[styles.statusDot, isOnline ? styles.statusDotOnline : styles.statusDotOffline]}
                />
                <Text style={[styles.statValue, styles.statusValue]}>{isOnline ? 'Online' : 'Offline'}</Text>
              </View>
            }
            right={<StatusToggle value={isOnline} disabled={togglingOnline} onToggle={handleToggleOnline} />}
          />
        </View>
      </IdentityHeader>

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
        {/* Active delivery — always visible (ongoing deliveries), even when offline */}
        {activeOrders.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active delivery</Text>
            {activeOrders.map((order) => (
              <ActiveDeliveryCard
                key={order.id}
                itemSummary={order.itemSummary}
                statusLabel={ACTIVE_STATUS_LABEL[order.status]}
                address={order.delivery_address}
                onPress={() => router.push({ pathname: '/(provider)/active/[id]', params: { id: order.id } })}
              />
            ))}
          </View>
        )}

        {/* New orders */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.sectionTitleLeft}>
              <Text style={styles.sectionTitle}>New orders</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/(provider)/recent-orders')}
              activeOpacity={0.7}
            >
              <Text style={styles.seeAll}>Recent Orders</Text>
            </TouchableOpacity>
          </View>

          {!isOnline ? (
            <EmptyState
              icon="wifi-off"
              message="You're offline"
              subtitle="Go online to start receiving new orders."
              style={styles.emptyPad}
            />
          ) : availableProductIds.length === 0 ? (
            <EmptyState
              icon="package"
              message="Enable products to receive orders"
              subtitle="Turn on items in your inventory to start getting orders."
              style={styles.emptyPad}
            />
          ) : orders.length === 0 ? (
            <EmptyState
              icon="inbox"
              message="No new orders"
              subtitle="New broadcast orders will appear here."
              style={styles.emptyPad}
            />
          ) : (
            orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                accepting={accepting === order.id}
                onAccept={() => handleAccept(order.id)}
              />
            ))
          )}
        </View>

      </ScrollView>

      {/* ── Provider nav ────────────────────────────────────────────── */}
      <FloatingPillNav
        tabs={[
          { key: 'home', label: 'Home', icon: 'home', badgeCount: (showIncoming ? orders.length : 0) + activeOrders.length },
          { key: 'products', label: 'Products', icon: 'package' },
          { key: 'earnings', label: 'Earnings', icon: 'wallet', iconLib: 'material' },
        ]}
        activeKey="home"
        onNavigate={(key) => {
          if (key === 'products') router.push('/(provider)/products');
          else if (key === 'earnings') router.push('/(provider)/earnings');
          // home → already here
        }}
      />

      <ConfirmModal
        visible={confirmOrderId != null}
        title="Accept Order"
        message="Are you sure you want to accept this order?"
        confirmLabel="Accept"
        loading={accepting != null}
        onConfirm={() => confirmOrderId && acceptOrder(confirmOrderId)}
        onCancel={() => setConfirmOrderId(null)}
      />
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
  const disabled = accepting || order.alreadyAccepted;
  return (
    <Card style={styles.orderCard}>
      <View style={styles.orderItemsRow}>
        <Text style={styles.orderItems} numberOfLines={1}>
          {order.itemSummary}
          {order.sizeSummary ? <Text style={styles.orderSize}> · {order.sizeSummary}</Text> : null}
        </Text>
        {order.is_express ? (
          <StatusBadge tone="express" label="Express" />
        ) : (
          <StatusBadge tone="successSolid" label="New" />
        )}
      </View>

      <View style={styles.orderAddrRow}>
        <Feather name="map-pin" size={13} color={colors.textMuted} />
        <Text style={styles.orderAddr} numberOfLines={2}>{order.delivery_address}</Text>
        <Text style={styles.timeAgo}>{timeAgo(order.created_at)}</Text>
      </View>

      <View style={styles.orderBottomRow}>
        <TouchableOpacity
          style={[styles.acceptBtn, disabled && styles.acceptBtnDisabled]}
          onPress={onAccept}
          disabled={disabled}
          activeOpacity={0.85}
        >
          {accepting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.acceptBtnText}>{order.alreadyAccepted ? 'Accepted' : 'Accept'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </Card>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Header — bell button in the IdentityHeader right slot
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.headerSurface,
    borderWidth: 1,
    borderColor: colors.headerSurfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Stat cards (rendered in the IdentityHeader children slot)
  statRow: { flexDirection: 'row', gap: spacing.md },
  // Matches the StatusToggle track (40×22) so it sits identically to the toggle
  // on the adjacent Status card.
  balanceTopUpBtn: {
    width: 40,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  statValue: { color: colors.headerText, fontSize: 18, fontWeight: '700' },
  statusValue: { fontSize: 15 },
  statusValueRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOnline: {
    backgroundColor: colors.headerAccent,
    shadowColor: colors.headerAccent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 2,
  },
  statusDotOffline: { backgroundColor: 'rgba(255,255,255,0.35)' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.xxl, paddingBottom: 100 },

  // Section
  section: { marginBottom: spacing.xxl },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitleLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  seeAll: { fontSize: 14, fontWeight: '600', color: colors.primary },

  emptyPad: { flex: undefined, paddingVertical: spacing.xxxl },


  // Incoming order card (white)
  orderCard: { padding: spacing.lg, marginBottom: spacing.sm },
  timeAgo: { fontSize: 12, color: colors.textMuted, marginLeft: 'auto' },
  orderItemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: 4,
  },
  orderItems: { fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  orderSize: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  orderAddrRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginBottom: spacing.md },
  orderAddr: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  orderBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtnDisabled: { opacity: 0.5 },
  acceptBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Recent order card (white)
});
