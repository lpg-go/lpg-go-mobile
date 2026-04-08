import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatPhone, formatPhoneAsEmail } from '../../lib/auth';
import supabase from '../../lib/supabase';
import { useAppLogo } from '../../lib/useAppLogo';

export default function LoginScreen() {
  const { logoUrl } = useAppLogo();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSignIn() {
    setError('');
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit phone number.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    const fullPhone = formatPhone(digits);
    const phoneAsEmail = formatPhoneAsEmail(fullPhone);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: phoneAsEmail,
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
    }
    // Root layout handles redirect once session is set
  }

  return (
    <SafeAreaView style={styles.flex}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {logoUrl ? (
          <Image
            source={{ uri: logoUrl }}
            style={styles.logoDynamic}
            resizeMode="contain"
          />
        ) : (
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        )}

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to your LPG Go account.</Text>

        <Text style={styles.label}>Phone number</Text>
        <View style={styles.phoneRow}>
          <Text style={styles.prefix}>🇵🇭 +63</Text>
          <TextInput
            style={styles.phoneInput}
            placeholder="9XX XXX XXXX"
            placeholderTextColor="#9CA3AF"
            keyboardType="number-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Enter your password"
            placeholderTextColor="#9CA3AF"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeButton}>
            <Text style={styles.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => router.push('/(auth)/register')}
        >
          <Text style={styles.linkText}>
            Don't have an account?{' '}
            <Text style={styles.linkBold}>Register</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  logo: {
    width: 120,
    height: 120,
    alignSelf: 'center',
    marginBottom: 24,
  },
  logoDynamic: {
    width: 200,
    height: 80,
    alignSelf: 'center',
    marginBottom: 24,
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
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  prefix: {
    fontSize: 15,
    color: '#111827',
    marginRight: 8,
  },
  phoneInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  passwordInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },
  eyeButton: { paddingLeft: 8 },
  eyeText: { fontSize: 13, color: PRIMARY, fontWeight: '500' },
  error: {
    fontSize: 13,
    color: '#EF4444',
    marginBottom: 12,
  },
  button: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  linkRow: { alignItems: 'center' },
  linkText: { fontSize: 14, color: '#6B7280' },
  linkBold: { color: PRIMARY, fontWeight: '600' },
});
