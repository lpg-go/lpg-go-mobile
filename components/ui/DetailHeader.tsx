import { Feather } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '../../lib/theme';

type Props = {
  title: string;
  subtitle?: string;
  // When provided, a frosted back arrow is shown and calls this on press.
  // Omit it to render the header with no back control.
  onBack?: () => void;
  // Optional right-side slot (e.g. a <StatusBadge/>), rendered at the row's end.
  right?: ReactNode;
};

// Shared dark detail-screen header. Extracted from the byte-for-byte copies in
// brand/[id], find-store/[productId], and order/[id] — values match those
// exactly so it's a drop-in visual replacement.
export default function DetailHeader({ title, subtitle, onBack, right }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      {onBack ? (
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={20} color={colors.headerText} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.headerTitleWrap}>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>

      {right ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Dark detail header — matches brand/[id].tsx styles ~215-235 exactly.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.headerSurface,
    borderWidth: 1,
    borderColor: colors.headerSurfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.headerText },
  headerSubtitle: { ...typography.caption, color: colors.headerSubtext, marginTop: 2 },
});
