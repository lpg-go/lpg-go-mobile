import { ReactNode } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, TouchableOpacity, View, ViewStyle } from 'react-native';

import { colors, radii, spacing } from '../../lib/theme';

type Props = {
  // Small uppercase caption above the value.
  label: string;
  // Primary value — a string/number rendered as the value text, or a custom node
  // (e.g. the Status card's dot + label).
  value: ReactNode;
  // 'onHeader' — translucent surface, sits inside the dark IdentityHeader (home).
  // 'standalone' — solid dark surface, for use on a light screen (earnings).
  variant?: 'onHeader' | 'standalone';
  // Optional trailing slot rendered to the right of the value (top-up button, toggle).
  right?: ReactNode;
  valueStyle?: StyleProp<TextStyle>;
  // When provided, the whole card becomes tappable.
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

// Shared provider stat card — a dark surface with an uppercase label and a value.
// Used for the home header's Balance/Status cards (onHeader) and the earnings
// report cards (standalone) so they all read identically.
export default function StatCard({
  label,
  value,
  variant = 'onHeader',
  right,
  valueStyle,
  onPress,
  style,
}: Props) {
  const composed = [styles.card, variant === 'standalone' && styles.cardStandalone, style];

  const valueNode =
    typeof value === 'string' || typeof value === 'number' ? (
      <Text style={[styles.value, valueStyle]}>{value}</Text>
    ) : (
      value
    );

  const inner = (
    <>
      <Text style={styles.label}>{label}</Text>
      {right ? (
        <View style={styles.row}>
          {valueNode}
          {right}
        </View>
      ) : (
        valueNode
      )}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={composed} onPress={onPress} activeOpacity={0.7}>
        {inner}
      </TouchableOpacity>
    );
  }

  return <View style={composed}>{inner}</View>;
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.headerSurface,
    borderWidth: 1,
    borderColor: colors.headerSurfaceBorder,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  // Solid dark base so the surface reads correctly off a light screen.
  cardStandalone: {
    backgroundColor: colors.headerBg,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  label: {
    color: colors.headerSubtext,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  value: { color: colors.headerText, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
