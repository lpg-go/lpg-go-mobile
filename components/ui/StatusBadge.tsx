import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radii, typography } from '../../lib/theme';

type Tone = 'success' | 'pending' | 'express' | 'review' | 'danger' | 'neutral';

type Props = {
  label: string;
  tone: Tone;
};

const TONES: Record<Tone, { bg: string; text: string }> = {
  success: { bg: colors.primaryTint, text: colors.primaryDark },
  pending: { bg: '#DBEAFE', text: '#185FA5' },
  express: { bg: colors.amberTint, text: colors.amberText },
  review: { bg: colors.amberTint, text: colors.amberDark },
  danger: { bg: colors.dangerTint, text: colors.danger },
  neutral: { bg: '#F3F4F6', text: colors.textSecondary },
};

export default function StatusBadge({ label, tone }: Props) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.label, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  label: {
    ...typography.caption,
    fontWeight: '600',
  },
});
