import { StyleSheet, View } from 'react-native';

import HeaderAvatar from './HeaderAvatar';
import HeaderOrders from './HeaderOrders';
import NotificationBell from './NotificationBell';

// The standard right-side icon row for customer headers: Orders + Bell + Avatar.
export default function CustomerHeaderActions() {
  return (
    <View style={styles.row}>
      <HeaderOrders href="/(customer)/orders" />
      <NotificationBell href="/(customer)/notifications" />
      <HeaderAvatar href="/(customer)/profile" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
