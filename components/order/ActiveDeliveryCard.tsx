import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, radii, shadows, spacing } from '../../lib/theme';

type Props = {
  itemSummary: string;
  statusLabel: string;
  address: string;
  onPress?: () => void;
};

// Green "in-progress order" card. Single source for the provider home
// "Active delivery" list and the customer "Active Orders" list — both render
// item summary + a status pill + the delivery address on a solid green surface.
export default function ActiveDeliveryCard({ itemSummary, statusLabel, address, onPress }: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.topRow}>
        <Text style={styles.items} numberOfLines={1}>{itemSummary}</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{statusLabel}</Text>
        </View>
      </View>
      <View style={styles.addrRow}>
        <Feather name="map-pin" size={13} color="rgba(255,255,255,0.85)" />
        <Text style={styles.addr} numberOfLines={1}>{address}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  items: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  pill: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  addr: { color: 'rgba(255,255,255,0.85)', fontSize: 12, flex: 1 },
});
