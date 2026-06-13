import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import supabase from '../lib/supabase';

const ACTIVE_STATUSES = ['awaiting_dealer_selection', 'in_transit', 'awaiting_confirmation'];

// Live count of the current customer's active orders (for the header badge).
function useActiveOrderCount() {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCount(0); return; }

    const { count: c } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', user.id)
      .in('status', ACTIVE_STATUSES);

    setCount(c ?? 0);
  }, []);

  useEffect(() => {
    fetchCount();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      channel = supabase
        .channel(`customer-active-orders-badge-${user.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${user.id}` },
          () => { fetchCount(); }
        )
        .subscribe();
    });

    return () => { if (channel) supabase.removeChannel(channel); };
  }, [fetchCount]);

  return count;
}

type Props = {
  href: '/(customer)/orders';
  color?: string;
};

// Orders icon for the customer header — package glyph with a live active-order
// count badge. Replaces the former Orders tab.
export default function HeaderOrders({ href, color = '#374151' }: Props) {
  const activeCount = useActiveOrderCount();

  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={() => router.push(href)}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <MaterialCommunityIcons name="cube-outline" size={24} color={color} />
      {activeCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{activeCount > 99 ? '99+' : activeCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
});
