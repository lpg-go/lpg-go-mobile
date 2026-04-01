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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import supabase from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type Transaction = {
  id: string;
  type: 'topup' | 'fee_deduction';
  amount: number;
  order_id: string | null;
  created_at: string;
};

const H_PADDING = 20;
const PRIMARY = '#16A34A';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProviderEarningsScreen() {
  const insets = useSafeAreaInsets();

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

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
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
        <Text style={styles.headerTitle}>Earnings</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + insets.bottom }]}
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
        {/* Balance card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Current Balance</Text>
          <Text style={styles.balanceAmount}>
            ₱{balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </Text>
          <TouchableOpacity
            style={styles.topUpBtn}
            onPress={() => router.push('/(provider)/topup' as never)}
            activeOpacity={0.8}
          >
            <Feather name="plus-circle" size={15} color={PRIMARY} />
            <Text style={styles.topUpBtnText}>Top Up</Text>
          </TouchableOpacity>
        </View>

        {/* Low balance warning */}
        {minBalance > 0 && balance < minBalance && (
          <View style={styles.lowBalanceWarning}>
            <Feather name="alert-triangle" size={16} color="#92400E" />
            <Text style={styles.lowBalanceText}>
              Your balance is below the minimum of{' '}
              ₱{minBalance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}.
              Top up to keep receiving orders.
            </Text>
          </View>
        )}

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { flex: 1 }]}>
            <Text style={styles.statValue}>
              ₱{monthlyFees.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </Text>
            <Text style={styles.statLabel}>This Month</Text>
          </View>
          <View style={[styles.statCard, { flex: 1 }]}>
            <Text style={styles.statValue}>{completedOrders}</Text>
            <Text style={styles.statLabel}>Completed</Text>
          </View>
          <View style={[styles.statCard, { flex: 1 }]}>
            <Text style={styles.statValue}>
              ₱{allTimeFees.toLocaleString('en-PH', { minimumFractionDigits: 0 })}
            </Text>
            <Text style={styles.statLabel}>All Time</Text>
          </View>
        </View>

        {/* Transaction history */}
        <Text style={styles.sectionTitle}>Transaction History</Text>

        {transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="file-text" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>
              No transactions yet.{'\n'}Complete deliveries to see earnings.
            </Text>
          </View>
        ) : (
          <View style={styles.txList}>
            {transactions.map((tx, index) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                isLast={index === transactions.length - 1}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Transaction row ──────────────────────────────────────────────────────────

function TransactionRow({ tx, isLast }: { tx: Transaction; isLast: boolean }) {
  const isTopUp = tx.type === 'topup';
  const date = new Date(tx.created_at).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const shortRef = tx.order_id ? tx.order_id.slice(-8).toUpperCase() : null;

  return (
    <View style={[styles.txRow, !isLast && styles.txRowBorder]}>
      <View style={[styles.txIcon, { backgroundColor: isTopUp ? '#DCFCE7' : '#FEE2E2' }]}>
        <Feather
          name={isTopUp ? 'arrow-up' : 'arrow-down'}
          size={16}
          color={isTopUp ? PRIMARY : '#DC2626'}
        />
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txType}>{isTopUp ? 'Top Up' : 'Fee Deducted'}</Text>
        {!isTopUp && shortRef && (
          <Text style={styles.txRef}>Order #{shortRef}</Text>
        )}
        <Text style={styles.txDate}>{date}</Text>
      </View>
      <Text style={[styles.txAmount, { color: isTopUp ? PRIMARY : '#DC2626' }]}>
        {isTopUp ? '+' : '-'}₱{Number(tx.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    paddingHorizontal: H_PADDING,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 20 },

  // Balance card
  balanceCard: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    alignItems: 'center',
  },
  balanceLabel: { fontSize: 13, color: '#86EFAC', fontWeight: '500', marginBottom: 6 },
  balanceAmount: { fontSize: 38, fontWeight: '800', color: '#fff', marginBottom: 16 },
  topUpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  topUpBtnText: { fontSize: 14, fontWeight: '700', color: PRIMARY },

  // Low balance warning
  lowBalanceWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 14,
    marginBottom: 16,
  },
  lowBalanceText: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 18 },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statValue: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 },
  statLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '500', textAlign: 'center' },

  // Section title
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 12 },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 40, gap: 12 },
  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 22 },

  // Transaction list
  txList: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  txRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txInfo: { flex: 1 },
  txType: { fontSize: 14, fontWeight: '600', color: '#111827' },
  txRef: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  txDate: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  txAmount: { fontSize: 14, fontWeight: '700' },
});
