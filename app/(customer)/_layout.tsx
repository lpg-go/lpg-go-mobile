import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { NotificationsProvider } from '../../lib/notificationsStore';
import supabase from '../../lib/supabase';

const PRIMARY = '#16A34A';
const INACTIVE = '#9CA3AF';

const ACTIVE_STATUSES = ['awaiting_dealer_selection', 'in_transit', 'awaiting_confirmation'];

// Live count of the current customer's active orders (for the Orders tab badge).
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

export default function CustomerLayout() {
  const activeCount = useActiveOrderCount();

  return (
    <NotificationsProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: PRIMARY,
          tabBarInactiveTintColor: INACTIVE,
          tabBarStyle: { borderTopColor: '#E5E7EB' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: 'Orders',
            tabBarIcon: ({ color, size }) => <Feather name="package" color={color} size={size} />,
            tabBarBadge: activeCount > 0 ? activeCount : undefined,
            tabBarBadgeStyle: { backgroundColor: PRIMARY, color: '#fff', fontSize: 10 },
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="profile"
          options={{ href: null }}
        />
        {/* Detail / utility screens — hidden from tab bar */}
        <Tabs.Screen
          name="brand/[id]"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="find-store/[productId]"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="order/[id]"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="chat/[orderId]"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="notifications"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
      </Tabs>
    </NotificationsProvider>
  );
}
