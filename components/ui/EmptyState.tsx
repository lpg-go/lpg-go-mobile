import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, spacing, typography } from '../../lib/theme';
import PrimaryButton from './PrimaryButton';

type Props = {
  // Omit for an iconless empty state (message + subtitle + optional CTA).
  icon?: string;
  // Some screens use MaterialCommunityIcons glyphs (e.g. gas-cylinder).
  iconLib?: 'feather' | 'material';
  message: string;
  subtitle?: string;
  // When both are provided, a PrimaryButton CTA is shown.
  actionLabel?: string;
  onAction?: () => void;
  // Override the container (e.g. paddingTop instead of flex:1) for empty states
  // placed inside a ScrollView rather than filling the screen.
  style?: StyleProp<ViewStyle>;
};

// The shared "nothing here" state: centered icon + message, optional subtitle and
// CTA. Defaults to a flex:1 centered column; pass `style` for scroll placements.
export default function EmptyState({
  icon,
  iconLib = 'feather',
  message,
  subtitle,
  actionLabel,
  onAction,
  style,
}: Props) {
  return (
    <View style={[styles.container, style]}>
      {icon ? (
        iconLib === 'material' ? (
          <MaterialCommunityIcons name={icon as never} size={40} color={colors.textFaint} />
        ) : (
          <Feather name={icon as never} size={40} color={colors.textFaint} />
        )
      ) : null}
      <Text style={styles.message}>{message}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.actionWrap}>
          <PrimaryButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  message: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  subtitle: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  actionWrap: { alignSelf: 'stretch', paddingHorizontal: spacing.xxxl },
});
