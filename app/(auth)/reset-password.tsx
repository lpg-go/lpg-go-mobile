import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import DetailHeader from '../../components/ui/DetailHeader';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { colors, radii, spacing, typography } from '../../lib/theme';

const RESET_PASSWORD_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/reset-password';

export default function ResetPasswordScreen() {
  const { phone, reset_token } = useLocalSearchParams<{ phone: string; reset_token: string }>();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleReset() {
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setLoading(true);

    const res = await fetch(RESET_PASSWORD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, reset_token, newPassword }),
    });
    const json = await res.json();
    setLoading(false);

    if (!res.ok || json.error) {
      setError(json.error ?? 'Failed to reset password. Try again.');
      return;
    }

    // Land the user on the login screen so they can sign in with the new password.
    Alert.alert('Password reset!', 'Sign in with your new password.');
    router.replace('/(auth)/login');
  }

  return (
    <View style={styles.screen}>
      <DetailHeader
        title="New password"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'))}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <Text style={styles.intro}>Create a new password for your account</Text>

          <Text style={styles.fieldLabel}>New password</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.rowInput}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPassword}
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeButton} hitSlop={8}>
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>Confirm new password</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.rowInput}
              placeholder="Re-enter your password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showConfirm}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            <TouchableOpacity onPress={() => setShowConfirm((v) => !v)} style={styles.eyeButton} hitSlop={8}>
              <Feather name={showConfirm ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton label="Reset Password" onPress={handleReset} loading={loading} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingTop: spacing.xxl },

  intro: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: spacing.xxl },

  fieldLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    marginBottom: spacing.lg,
  },
  rowInput: { flex: 1, fontSize: 15, color: colors.text, padding: 0 },
  eyeButton: { paddingLeft: spacing.sm },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerTint,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: 13, color: colors.danger },
});
