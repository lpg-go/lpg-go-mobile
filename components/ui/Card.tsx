import { ReactNode } from 'react';
import { StyleProp, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';

import { colors, radii, shadows } from '../../lib/theme';

type Props = {
  children: ReactNode;
  // Per-use overrides — padding, margin, width, flexDirection, etc.
  style?: StyleProp<ViewStyle>;
  // Optional convenience padding. Applied only when provided (no baked-in
  // default — card padding varies per use). `style` still wins over it.
  padding?: number;
  // When provided, the card renders as a TouchableOpacity (tappable surface).
  // Omit it for a plain, non-interactive View.
  onPress?: () => void;
  // Only used when onPress is set. Defaults to 0.7.
  activeOpacity?: number;
};

// The standard white surface card: bg + radius + border + shadow. Nothing else
// is baked in (padding/margin/layout vary per screen) — pass those via `style`
// or the `padding` convenience prop. Pass `onPress` to make it tappable.
export default function Card({ children, style, padding, onPress, activeOpacity }: Props) {
  const composed = [styles.card, padding != null && { padding }, style];

  if (onPress) {
    return (
      <TouchableOpacity style={composed} onPress={onPress} activeOpacity={activeOpacity ?? 0.7}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={composed}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
});
