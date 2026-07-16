import { useCallback, useEffect, useState } from 'react';

import supabase from './supabase';

const ACTIVE_STATUSES = ['awaiting_dealer_selection', 'in_transit', 'awaiting_confirmation'] as const;

// Live count of the current customer's active orders (for header / nav badges).
// Self-contained: owns its own count query + realtime channel, takes no args.
export function useActiveOrderCount(): number {
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
    // getUser() is async: if we unmount before it resolves, cleanup would run
    // while channel is still null and the later subscribe would leak a channel
    // nobody removes. The flag makes cleanup win that race.
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return;
      channel = supabase
        .channel(`customer-active-orders-badge-${user.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${user.id}` },
          () => { fetchCount(); }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchCount]);

  return count;
}
