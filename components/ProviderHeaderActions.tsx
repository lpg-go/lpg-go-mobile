import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, usePathname } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import HeaderAvatar from './HeaderAvatar';
import NotificationBell from './NotificationBell';
import supabase from '../lib/supabase';

const ACTIVE = '#16A34A';
const INACTIVE = '#374151';

// A single header icon button (Credit / Products). Highlights green when it's
// the current screen.
function HeaderIconButton({
  icon,
  href,
  active,
}: {
  icon: keyof typeof Feather.glyphMap;
  href: string;
  active: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.iconBtn}
      onPress={() => router.push(href as never)}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Feather name={icon} size={22} color={active ? ACTIVE : INACTIVE} />
    </TouchableOpacity>
  );
}

// The standard right-side icon row for provider headers:
// Credit + Products + Bell + Avatar.
// Fetches the signed-in provider's is_online itself (refreshed on focus) so the
// avatar's online dot stays correct on every provider header without each screen
// wiring it. The icon for the current screen is highlighted in green.
export default function ProviderHeaderActions() {
  const pathname = usePathname();
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('profiles')
          .select('is_online')
          .eq('id', user.id)
          .single();
        if (alive && data) setIsOnline(data.is_online);
      })();
      return () => { alive = false; };
    }, [])
  );

  return (
    <View style={styles.row}>
      <HeaderIconButton icon="credit-card" href="/(provider)/earnings" active={pathname === '/earnings'} />
      <HeaderIconButton icon="box" href="/(provider)/products" active={pathname === '/products'} />
      <NotificationBell href="/(provider)/notifications" active={pathname === '/notifications'} />
      <HeaderAvatar href="/(provider)/profile" online={isOnline} active={pathname === '/profile'} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
