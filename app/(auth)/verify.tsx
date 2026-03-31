import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
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

type Params = {
  phone?: string;
  email?: string;
  from?: 'login' | 'register';
  full_name?: string;
  role?: string;
  provider_type?: string;
  business_name?: string;
};

export default function VerifyScreen() {
  const params = useLocalSearchParams<Params>();
  const { phone, email, from, full_name, role, provider_type, business_name } = params;

  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const displayContact = phone ?? email ?? '';

  async function handleVerify() {
    setError('');
    if (token.length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }

    setLoading(true);

    let verifyError: { message: string } | null = null;
    let userId: string | undefined;

    if (phone) {
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: 'sms',
      });
      verifyError = error;
      userId = data.user?.id;
    } else if (email) {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });
      verifyError = error;
      userId = data.user?.id;
    }

    if (verifyError) {
      setLoading(false);
      setError(verifyError.message);
      return;
    }

    // After register OTP flow: upsert profile then navigate
    if (from === 'register' && userId) {
      const profileRow: Record<string, unknown> = {
        id: userId,
        full_name: full_name ?? '',
        phone: phone ?? '',
        role: role ?? 'customer',
        updated_at: new Date().toISOString(),
      };
      if (provider_type) profileRow.provider_type = provider_type;
      if (business_name) profileRow.business_name = business_name;

      const { error: profileError } = await supabase.from('profiles').upsert(profileRow);
      setLoading(false);

      if (profileError) {
        setError(profileError.message);
        return;
      }

      if (role === 'customer') router.replace('/(customer)');
      else router.replace('/(provider)');
      return;
    }

    setLoading(false);
    // login flow: root layout handles redirect
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Enter OTP</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{' '}
          <Text style={styles.subtitleBold}>{displayContact}</Text>
        </Text>

        <Text style={styles.label}>Verification code</Text>
        <TextInput
          style={styles.codeInput}
          placeholder="------"
          placeholderTextColor="#9CA3AF"
          keyboardType="number-pad"
          maxLength={6}
          value={token}
          onChangeText={setToken}
          autoFocus
        />

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

        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <Text style={styles.backText}>Wrong number? Go back</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 28,
  },
  subtitleBold: {
    fontWeight: '600',
    color: '#111827',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  codeInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 24,
    color: '#111827',
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 16,
  },
  error: { fontSize: 13, color: '#EF4444', marginBottom: 12 },
  button: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  backRow: { alignItems: 'center' },
  backText: { fontSize: 14, color: '#6B7280' },
});
