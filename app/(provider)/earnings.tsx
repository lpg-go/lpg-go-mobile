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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import FloatingPillNav from '../../components/ui/FloatingPillNav';
import StatCard from '../../components/ui/StatCard';
import { peso } from '../../lib/format';
import supabase from '../../lib/supabase';
import { colors, radii, spacing } from '../../lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type TxType = 'topup' | 'promo' | 'loyalty' | 'fee_deduction' | 'express_platform_fee';

type Transaction = {
  id: string;
  type: TxType;
  amount: number;
  order_id: string | null;
  created_at: string;
};

const H_PADDING = 20;

// Per-type presentation: label, icon, and the tinted circle behind it.
function txMeta(type: TxType): { label: string; icon: keyof typeof Feather.glyphMap; iconColor: string; circleBg: string } {
  switch (type) {
    case 'topup':
      return { label: 'Top up', icon: 'arrow-down-left', iconColor: colors.primary, circleBg: colors.primaryTint };
    case 'promo':
      return { label: 'Promo', icon: 'gift', iconColor: colors.primary, circleBg: colors.primaryTint };
    case 'loyalty':
      return { label: 'Loyalty', icon: 'award', iconColor: colors.primary, circleBg: colors.primaryTint };
    case 'express_platform_fee':
      return { label: 'Express fee', icon: 'zap', iconColor: colors.amberText, circleBg: colors.amberTint };
    case 'fee_deduction':
    default:
      return { label: 'Admin fee', icon: 'arrow-up-right', iconColor: colors.danger, circleBg: colors.dangerTint };
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProviderEarningsScreen() {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [minBalance, setMinBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [completedOrders, setCompletedOrders] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    boot();
  }, []);

  // Realtime: listen for new transactions for this provider
  useEffect(() => {
    if (!providerId) return;
    const channel = supabase
      .channel(`transactions-${providerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transactions',
          filter: `provider_id=eq.${providerId}`,
        },
        () => {
          fetchAll(providerId);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [providerId]);

  async function boot() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setProviderId(user.id);
    await fetchAll(user.id);
    setLoading(false);
  }

  async function fetchAll(uid: string) {
    await Promise.all([
      fetchBalance(uid),
      fetchTransactions(uid),
      fetchCompletedOrders(uid),
      fetchMinBalance(),
    ]);
  }

  async function fetchMinBalance() {
    const { data } = await supabase
      .from('platform_settings')
      .select('min_balance')
      .single();
    if (data) setMinBalance(Number(data.min_balance));
  }

  async function fetchBalance(uid: string) {
    const { data } = await supabase
      .from('profiles')
      .select('balance')
      .eq('id', uid)
      .single();
    if (data) setBalance(Number(data.balance));
  }

  async function fetchTransactions(uid: string) {
    const { data } = await supabase
      .from('transactions')
      .select('id, type, amount, order_id, created_at')
      .eq('provider_id', uid)
      .order('created_at', { ascending: false });
    if (data) setTransactions(data as Transaction[]);
  }

  async function fetchCompletedOrders(uid: string) {
    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('selected_provider_id', uid)
      .eq('status', 'delivered');
    setCompletedOrders(count ?? 0);
  }

  async function handleRefresh() {
    if (!providerId) return;
    setRefreshing(true);
    await fetchAll(providerId);
    setRefreshing(false);
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const monthlyFees = transactions
    .filter((t) => t.type === 'fee_deduction' && t.created_at >= monthStart)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const allTimeFees = transactions
    .filter((t) => t.type === 'fee_deduction')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.headerTitle}>Earnings</Text>
      <Text style={styles.headerSubtitle}>Your balance, fees, and history</Text>
    </View>
  );

  const nav = (
    <FloatingPillNav
      tabs={[
        { key: 'home', label: 'Home', icon: 'home' },
        { key: 'products', label: 'Products', icon: 'package' },
        { key: 'earnings', label: 'Earnings', icon: 'wallet', iconLib: 'material' },
      ]}
      activeKey="earnings"
      onNavigate={(key) => {
        if (key === 'home') router.replace('/(provider)');
        else if (key === 'products') router.push('/(provider)/products');
        // earnings → already here
      }}
    />
  );

  return (
    <View style={styles.screen}>
      {header}

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
        {/* Low balance warning */}
        {minBalance > 0 && balance < minBalance && (
          <View style={styles.lowBalanceWarning}>
            <Feather name="alert-triangle" size={16} color={colors.amberText} />
            <Text style={styles.lowBalanceText}>
              Your balance is below the minimum of{' '}
              {peso(minBalance)}. Top up to keep receiving orders.
            </Text>
          </View>
        )}

        {/* Stat cards */}
        <View style={styles.statsRow}>
          <StatCard variant="standalone" label="This month" value={peso(monthlyFees)} />
          <StatCard variant="standalone" label="All time" value={peso(allTimeFees)} />
          <StatCard variant="standalone" label="Delivered" value={String(completedOrders)} />
        </View>

        {/* Transaction history */}
        <Text style={styles.sectionTitle}>Transaction History</Text>

        {transactions.length === 0 ? (
          <EmptyState
            icon="file-text"
            message="No transactions yet"
            subtitle="Complete deliveries to see earnings."
            style={styles.emptyPad}
          />
        ) : (
          <Card style={styles.txList}>
            {transactions.map((tx, index) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                isLast={index === transactions.length - 1}
              />
            ))}
          </Card>
        )}
      </ScrollView>

      {nav}
    </View>
  );
}

// ─── Transaction row ──────────────────────────────────────────────────────────

function TransactionRow({ tx, isLast }: { tx: Transaction; isLast: boolean }) {
  // Both top-ups and promo credits add to balance (credit, + sign).
  const isCredit = tx.type === 'topup' || tx.type === 'promo' || tx.type === 'loyalty';
  const meta = txMeta(tx.type);
  const date = new Date(tx.created_at).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const shortRef = tx.order_id ? tx.order_id.slice(-8).toUpperCase() : null;

  return (
    <View style={[styles.txRow, !isLast && styles.txRowBorder]}>
      <View style={[styles.txIcon, { backgroundColor: meta.circleBg }]}>
        <Feather name={meta.icon} size={16} color={meta.iconColor} />
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txType}>{meta.label}</Text>
        <Text style={styles.txDate}>{shortRef ? `#${shortRef} · ` : ''}{date}</Text>
      </View>
      <Text style={[styles.txAmount, { color: isCredit ? colors.primary : colors.danger }]}>
        {isCredit ? '+' : '-'}{peso(tx.amount)}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: colors.headerText },
  headerSubtitle: { fontSize: 13, color: colors.headerSubtext, marginTop: 2 },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg, paddingBottom: 100 },

  // Low balance warning
  lowBalanceWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.amberTint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  lowBalanceText: { flex: 1, fontSize: 13, color: colors.amberText, lineHeight: 18 },

  // Stat cards
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xxl },

  // Section title
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.md },

  // Empty state
  emptyPad: { flex: undefined, paddingTop: spacing.xxxl, paddingBottom: spacing.md },

  // Transaction list
  txList: { overflow: 'hidden' },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  txRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.grey100 },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  txInfo: { flex: 1 },
  txType: { fontSize: 13, fontWeight: '600', color: colors.text },
  txDate: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  txAmount: { fontSize: 14, fontWeight: '700' },
});
