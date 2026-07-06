import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
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
import { formatPhone } from '../../lib/auth';
import { colors, radii, spacing } from '../../lib/theme';

const SEND_OTP_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/send-otp';

export default function ForgotPasswordScreen() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Keep digits only, drop any leading 0 (the national trunk prefix — "+63" is
  // already shown), and cap at 10 digits, so "0917..." becomes "917..." and the
  // stored value matches what the server's normalizePhone expects.
  function handlePhoneChange(text: string) {
    setPhone(text.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10));
  }

  async function handleSendOtp() {
    setError('');
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit phone number.');
      return;
    }
    if (digits[0] !== '9') {
      setError('Phone number should start with 9 after +63.');
      return;
    }

    const fullPhone = formatPhone(digits);
    setLoading(true);

    const res = await fetch(SEND_OTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: fullPhone, purpose: 'forgot_password' }),
    });
    const json = await res.json();
    setLoading(false);

    if (json.error === 'not_found') {
      setError('No account found for this number.');
      return;
    }

    if (!res.ok || json.error) {
      setError(json.message ?? json.error ?? 'Failed to send OTP. Try again.');
      return;
    }

    router.push({
      pathname: '/(auth)/verify-otp',
      params: { action: 'forgot_password', phone: fullPhone },
    });
  }

  return (
    <View style={styles.screen}>
      <DetailHeader
        title="Forgot password"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'))}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <Text style={styles.intro} numberOfLines={1}>
            Enter your number to get a reset code.
          </Text>
          <View style={styles.inputRow}>
            <Text style={styles.prefix}>🇵🇭 +63</Text>
            <TextInput
              style={styles.rowInput}
              placeholder="9XX XXX XXXX"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={10}
              value={phone}
              onChangeText={handlePhoneChange}
            />
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton label="Send Code" onPress={handleSendOtp} loading={loading} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingTop: spacing.xxl },

  intro: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
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
  prefix: { fontSize: 15, color: colors.textMuted },
  rowInput: { flex: 1, fontSize: 15, color: colors.text, padding: 0 },

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
