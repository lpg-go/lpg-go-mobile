import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import supabase from '../../lib/supabase';

const SEND_OTP_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/send-otp';
const VERIFY_OTP_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/verify-otp';
const PRIMARY = '#16A34A';
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

    // 1. Verify the OTP
    const verifyRes = await fetch(VERIFY_OTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    const verifyJson = await verifyRes.json();

    if (!verifyJson.success) {
      setLoading(false);
      setError(verifyJson.error ?? 'Invalid or expired OTP.');
      return;
    }

    // 2a. Forgot password — go to reset screen
    if (action === 'forgot_password') {
      setLoading(false);
      router.replace({ pathname: '/(auth)/reset-password', params: { phone } });
      return;
    }

    // 2b. OTP verified — register the user
    const phoneAsEmail = `${phone.replace(/^\+/, '')}@lpggo.app`;
    const metadata: Record<string, string> = {
      full_name: fullName ?? '',
      phone,
      role: role ?? 'customer',
    };
    if (role === 'provider' && providerType) {
      metadata.provider_type = providerType;
      if (providerType === 'dealer' && businessName) metadata.business_name = businessName;
    }

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: phoneAsEmail,
      password,
      options: { data: metadata },
    });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    const userId = signUpData.user?.id;
    if (userId) {
      const profileRow: Record<string, unknown> = {
        id: userId,
        full_name: fullName?.trim() ?? '',
        phone,
        role: role ?? 'customer',
        updated_at: new Date().toISOString(),
      };
      if (role === 'provider') {
        profileRow.provider_type = providerType;
        if (providerType === 'dealer' && businessName) profileRow.business_name = businessName;
      }

      const { error: profileError } = await supabase.from('profiles').upsert(profileRow);
      if (profileError) {
        setLoading(false);
        setError(profileError.message);
        return;
      }
    }

    setLoading(false);
    if (role === 'customer') router.replace('/(customer)');
    else router.replace('/(provider)');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Enter verification code</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{'\n'}
          <Text style={styles.phoneHighlight}>{phone}</Text>
        </Text>

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

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Verify</Text>
          )}
        </TouchableOpacity>

        <View style={styles.timerBlock}>
          {expiry > 0 ? (
            <Text style={styles.expiryText}>
              Code expires in <Text style={styles.expiryBold}>{formatTime(expiry)}</Text>
            </Text>
          ) : (
            <Text style={styles.expiredText}>Code expired. Please resend.</Text>
          )}

          <View style={styles.resendRow}>
            <TouchableOpacity
              onPress={handleResend}
              disabled={countdown > 0}
              activeOpacity={0.7}
            >
              <Text style={[styles.resendLink, countdown > 0 && styles.resendLinkDisabled]}>
                Resend code
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  back: { marginBottom: 24 },
  backText: { fontSize: 15, color: PRIMARY, fontWeight: '500' },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 32,
    lineHeight: 22,
  },
  phoneHighlight: { color: '#111827', fontWeight: '600' },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 8,
  },
  otpBox: {
    flex: 1,
    height: 56,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  otpBoxFilled: {
    borderColor: PRIMARY,
    backgroundColor: '#F0FDF4',
  },
  error: { fontSize: 13, color: '#EF4444', marginBottom: 12 },
  button: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  timerBlock: { alignItems: 'center', gap: 8 },
  expiryText: { fontSize: 14, color: '#6B7280' },
  expiryBold: { fontWeight: '700', color: '#111827' },
  expiredText: { fontSize: 14, color: '#EF4444', fontWeight: '600' },
  resendRow: { alignItems: 'center' },
  resendLink: { fontSize: 14, color: PRIMARY, fontWeight: '600' },
  resendLinkDisabled: { opacity: 0.4 },
});
