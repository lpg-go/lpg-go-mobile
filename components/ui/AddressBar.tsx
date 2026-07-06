import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radii, typography } from '../../lib/theme';

type Props = {
  address: string;
  onPress?: () => void;
};

export default function AddressBar({ address, onPress }: Props) {
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.8}
      disabled={!onPress}
    >
      <Feather name="map-pin" size={16} color={colors.headerAccent} />
      <Text style={styles.address} numberOfLines={1}>
        {address}
      </Text>
      <Feather name="chevron-down" size={16} color={colors.headerSubtext} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.headerSurface,
    borderWidth: 1,
    borderColor: colors.headerSurfaceBorder,
  },
  address: {
    ...typography.body,
    color: colors.headerText,
    flex: 1,
  },
});
