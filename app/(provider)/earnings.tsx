import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Card from '../../components/ui/Card';
import DetailHeader from '../../components/ui/DetailHeader';
import EmptyState from '../../components/ui/EmptyState';
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

  const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 0 })}`;

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <DetailHeader
        title="Earnings"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(provider)'))}
      />

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
        {/* Balance card */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceLeft}>
            <Text style={styles.balanceLabel}>Available balance</Text>
            <Text style={styles.balanceAmount}>
              {balance.toLocaleString('en-PH', { minimumFractionDigits: 0 })}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.topUpBtn}
            onPress={() => router.push('/(provider)/topup' as never)}
            activeOpacity={0.8}
          >
            <Feather name="plus-circle" size={15} color="#fff" />
            <Text style={styles.topUpBtnText}>Top Up</Text>
          </TouchableOpacity>
        </View>

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
          <Card style={styles.statCard}>
            <Text style={styles.statTitle}>This month</Text>
            <Text style={styles.statValue}>{peso(monthlyFees)}</Text>
            <Text style={styles.statUnit}>in fees</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statTitle}>All time</Text>
            <Text style={styles.statValue}>{peso(allTimeFees)}</Text>
            <Text style={styles.statUnit}>in fees</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statTitle}>Delivered</Text>
            <Text style={styles.statValue}>{completedOrders}</Text>
            <Text style={styles.statUnit}>orders</Text>
          </Card>
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
        {isCredit ? '+' : '-'}{peso0(tx.amount)}
      </Text>
    </View>
  );
}

function peso0(n: number): string {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0 })}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg, paddingBottom: spacing.xxxl },

  // Balance card
  balanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  balanceLeft: { flex: 1 },
  balanceLabel: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  balanceAmount: { fontSize: 36, fontWeight: '800', color: '#fff', marginTop: 4 },
  topUpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
  },
  topUpBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

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
  statCard: { flex: 1, padding: spacing.md, alignItems: 'flex-start' },
  statTitle: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  statValue: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 4 },
  statUnit: { fontSize: 10, color: colors.textMuted, marginTop: 1 },

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
