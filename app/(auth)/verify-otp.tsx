import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import supabase from '../../lib/supabase';
import { colors, radii, spacing } from '../../lib/theme';

const SEND_OTP_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/send-otp';
const VERIFY_OTP_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/verify-otp';
const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;
// Mirror the server's OTP validity window (send-otp sets expires_at = now + 15m).
const EXPIRY_SECONDS = 15 * 60;

function formatTime(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{
    action: 'register' | 'forgot_password';
    phone: string;
    password: string;
    fullName?: string;
    role?: string;
    providerType?: string;
    businessName?: string;
    complianceAccepted?: string;
    complianceVersion?: string;
    complianceText?: string;
  }>();

  const {
    action,
    phone,
    password,
    fullName,
    role,
    providerType,
    businessName,
    complianceAccepted,
    complianceVersion,
    complianceText,
  } = params;

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  // Code-expiry countdown, tracked client-side from when this screen mounted
  // (i.e. right after the OTP was sent). Reset on resend.
  const [expiry, setExpiry] = useState(EXPIRY_SECONDS);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Resend-cooldown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Code-expiry timer
  useEffect(() => {
    if (expiry <= 0) return;
    const t = setTimeout(() => setExpiry((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [expiry]);

  function handleDigitChange(text: string, index: number) {
    const char = text.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyPress(key: string, index: number) {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
      inputRefs.current[index - 1]?.focus();
    }
  }

  async function handleResend() {
    setError('');
    setCountdown(RESEND_SECONDS);
    setExpiry(EXPIRY_SECONDS);
    setDigits(Array(OTP_LENGTH).fill(''));
    inputRefs.current[0]?.focus();

    const res = await fetch(SEND_OTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      setError(json.error ?? 'Failed to resend OTP.');
    }
  }

  async function handleVerify() {
    const code = digits.join('');
    if (code.length < OTP_LENGTH) {
      setError('Enter the full 6-digit code.');
      return;
    }

    setError('');
    setLoading(true);

    // Forgot password: verify-otp is the real consume point (like signup). It
    // verifies + burns the OTP and, on success, returns a short-lived opaque
    // reset_token. We carry that token (NOT the code) to reset-password, which
    // gates the password change on the token.
    if (action === 'forgot_password') {
      const res = await fetch(VERIFY_OTP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, purpose: 'forgot_password' }),
      });
      const json = await res.json();
      setLoading(false);

      if (!json.success || !json.reset_token) {
        setError(json.error ?? 'Invalid or expired OTP.');
        return;
      }

      router.replace({
        pathname: '/(auth)/reset-password',
        params: { phone, reset_token: json.reset_token },
      });
      return;
    }

    // Registration: verify + consume the OTP AND create the account server-side
    // in one call. The account is created with the service-role admin client
    // inside verify-otp — the client no longer calls supabase.auth.signUp.
    const verifyRes = await fetch(VERIFY_OTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        code,
        password,
        full_name: fullName ?? '',
        role: role ?? 'customer',
        provider_type: role === 'provider' ? (providerType ?? '') : '',
        business_name:
          role === 'provider' && providerType === 'dealer' ? (businessName ?? '') : '',
      }),
    });
    const verifyJson = await verifyRes.json();

    if (!verifyJson.success) {
      setLoading(false);
      setError(verifyJson.error ?? 'Invalid or expired OTP.');
      return;
    }

    // Account created server-side — sign in now to obtain a client session
    // (admin.createUser does not return one).
    const phoneAsEmail = `${phone.replace(/^\+/, '')}@lpggo.app`;
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: phoneAsEmail,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    if (role === 'customer') router.replace('/(customer)');
    else router.replace('/(provider)');
  }

  return (
    <View style={styles.screen}>
      <DetailHeader
        title="Verify your number"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'))}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <Text style={styles.subtitle}>Enter the 6-digit code sent to</Text>
          <Text style={styles.phone}>{phone}</Text>

          <View style={styles.otpRow}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                ref={(r) => { inputRefs.current[i] = r; }}
                style={[styles.otpBox, d ? styles.otpBoxFilled : null]}
                value={d}
                onChangeText={(t) => handleDigitChange(t, i)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
              />
            ))}
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton label="Verify" onPress={handleVerify} loading={loading} />

          <View style={styles.timerBlock}>
            {expiry > 0 ? (
              <Text style={styles.expiryText}>
                Code expires in <Text style={styles.expiryBold}>{formatTime(expiry)}</Text>
              </Text>
            ) : (
              <Text style={styles.expiredText}>Code expired. Please resend.</Text>
            )}

            {countdown > 0 ? (
              <Text style={styles.resendMuted}>Resend code in {formatTime(countdown)}</Text>
            ) : (
              <TouchableOpacity onPress={handleResend} activeOpacity={0.7}>
                <Text style={styles.resendLink}>Resend code</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingTop: spacing.xxl, alignItems: 'center' },

  subtitle: { fontSize: 14, color: colors.textSecondary },
  phone: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 2 },

  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  otpBox: {
    flex: 1,
    height: 56,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  otpBoxFilled: { borderColor: colors.primary },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.sm,
    backgroundColor: colors.dangerTint,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: 13, color: colors.danger },

  timerBlock: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  expiryText: { fontSize: 14, color: colors.textMuted },
  expiryBold: { fontWeight: '700', color: colors.text },
  expiredText: { fontSize: 14, color: colors.danger, fontWeight: '600' },
  resendMuted: { fontSize: 14, color: colors.textMuted },
  resendLink: { fontSize: 14, color: colors.primary, fontWeight: '700' },
});
