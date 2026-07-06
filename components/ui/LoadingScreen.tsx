import { ActivityIndicator, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, spacing } from '../../lib/theme';

type Props = {
  message?: string;
  // Optional container override (e.g. an added top inset).
  style?: StyleProp<ViewStyle>;
};

// The shared centered spinner. Fills its parent (flex:1) and centers a large
// primary ActivityIndicator, with an optional muted message below.
export default function LoadingScreen({ message, style }: Props) {
  return (
    <View style={[styles.container, style]}>
      <ActivityIndicator size="large" color={colors.primary} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.bg,
  },
  message: { fontSize: 14, color: colors.textMuted },
});
