import { Modal, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../lib/theme';
import PrimaryButton from './PrimaryButton';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // 'primary' for normal confirms, 'danger' for destructive ones.
  confirmVariant?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// Shared confirmation popup — a styled replacement for the native Alert.alert
// confirm dialog. Two actions: Cancel (outline) + Confirm (primary/danger).
export default function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  loading,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <View style={styles.actions}>
            <View style={styles.actionBtn}>
              <PrimaryButton label={cancelLabel} variant="outline" onPress={onCancel} disabled={loading} />
            </View>
            <View style={styles.actionBtn}>
              <PrimaryButton
                label={confirmLabel}
                variant={confirmVariant}
                onPress={onConfirm}
                loading={loading}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: { ...typography.cardTitle, fontSize: 18, color: colors.text, textAlign: 'center' },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  actionBtn: { flex: 1 },
});
