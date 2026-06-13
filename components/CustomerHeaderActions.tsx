import { usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import HeaderAvatar from './HeaderAvatar';
import HeaderOrders from './HeaderOrders';
import NotificationBell from './NotificationBell';

// The standard right-side icon row for customer headers: Orders + Bell + Avatar.
// The icon for the current screen is highlighted with a green ring.
export default function CustomerHeaderActions() {
  const pathname = usePathname();

  return (
    <View style={styles.row}>
      <HeaderOrders href="/(customer)/orders" active={pathname === '/orders'} />
      <NotificationBell href="/(customer)/notifications" active={pathname === '/notifications'} />
      <HeaderAvatar href="/(customer)/profile" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
