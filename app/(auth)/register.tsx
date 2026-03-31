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

import { formatPhone, formatPhoneAsEmail } from '../../lib/auth';
import supabase from '../../lib/supabase';

type Role = 'customer' | 'provider';
type ProviderType = 'dealer' | 'rider';

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [providerType, setProviderType] = useState<ProviderType | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    setError('');

    if (!fullName.trim()) { setError('Full name is required.'); return; }
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) { setError('Enter a valid 10-digit phone number.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (!role) { setError('Please select your role.'); return; }
    if (role === 'provider' && !providerType) { setError('Please select dealer or rider.'); return; }
    if (role === 'provider' && providerType === 'dealer' && !businessName.trim()) {
      setError('Business name is required for dealers.');
      return;
    }

    const fullPhone = formatPhone(digits);
    const phoneAsEmail = formatPhoneAsEmail(fullPhone);
    setLoading(true);

    const metadata: Record<string, string> = {
      full_name: fullName.trim(),
      phone: fullPhone,
      role,
    };
    if (role === 'provider' && providerType) {
      metadata.provider_type = providerType;
      if (providerType === 'dealer') metadata.business_name = businessName.trim();
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
        full_name: fullName.trim(),
        phone: fullPhone,
        role,
        updated_at: new Date().toISOString(),
      };
      if (role === 'provider') {
        profileRow.provider_type = providerType;
        if (providerType === 'dealer') profileRow.business_name = businessName.trim();
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
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Image
          source={require('../../assets/images/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Join LPG Go to get started.</Text>

        {/* Full name */}
        <Text style={styles.label}>Full name</Text>
        <TextInput
          style={styles.input}
          placeholder="Juan dela Cruz"
          placeholderTextColor="#9CA3AF"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />

        {/* Phone */}
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

        {/* Password */}
        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="At least 6 characters"
            placeholderTextColor="#9CA3AF"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeButton}>
            <Text style={styles.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        {/* Confirm password */}
        <Text style={styles.label}>Confirm password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Re-enter your password"
            placeholderTextColor="#9CA3AF"
            secureTextEntry={!showConfirm}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
          <TouchableOpacity onPress={() => setShowConfirm((v) => !v)} style={styles.eyeButton}>
            <Text style={styles.eyeText}>{showConfirm ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        {/* Role selection */}
        <Text style={styles.label}>I am...</Text>
        <View style={styles.optionGroup}>
          <RoleOption
            label="I want to order LPG"
            selected={role === 'customer'}
            onPress={() => { setRole('customer'); setProviderType(null); }}
          />
          <RoleOption
            label="I am a provider"
            selected={role === 'provider'}
            onPress={() => setRole('provider')}
          />
        </View>

        {/* Provider sub-options */}
        {role === 'provider' && (
          <>
            <Text style={styles.label}>Provider type</Text>
            <View style={styles.optionGroup}>
              <RoleOption
                label="Dealer"
                selected={providerType === 'dealer'}
                onPress={() => setProviderType('dealer')}
              />
              <RoleOption
                label="Rider"
                selected={providerType === 'rider'}
                onPress={() => { setProviderType('rider'); setBusinessName(''); }}
              />
            </View>

            {providerType === 'dealer' && (
              <>
                <Text style={styles.label}>Business name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Dela Cruz LPG"
                  placeholderTextColor="#9CA3AF"
                  value={businessName}
                  onChangeText={setBusinessName}
                  autoCapitalize="words"
                />
              </>
            )}
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Register</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => router.push('/(auth)/login')}
        >
          <Text style={styles.linkText}>
            Already have an account?{' '}
            <Text style={styles.linkBold}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RoleOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.roleOption, selected && styles.roleOptionSelected]}
    >
      <Text style={[styles.roleOptionText, selected && styles.roleOptionTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  logo: {
    width: 100,
    height: 100,
    alignSelf: 'center',
    marginBottom: 20,
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
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    marginBottom: 16,
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
  prefix: { fontSize: 15, color: '#111827', marginRight: 8 },
  phoneInput: { flex: 1, fontSize: 15, color: '#111827', padding: 0 },
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
  passwordInput: { flex: 1, fontSize: 15, color: '#111827', padding: 0 },
  eyeButton: { paddingLeft: 8 },
  eyeText: { fontSize: 13, color: PRIMARY, fontWeight: '500' },
  optionGroup: { gap: 10, marginBottom: 16 },
  roleOption: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  roleOptionSelected: {
    borderColor: PRIMARY,
    backgroundColor: '#F0FDF4',
  },
  roleOptionText: { fontSize: 15, fontWeight: '500', color: '#374151' },
  roleOptionTextSelected: { color: PRIMARY },
  error: { fontSize: 13, color: '#EF4444', marginBottom: 12 },
  button: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  linkRow: { alignItems: 'center' },
  linkText: { fontSize: 14, color: '#6B7280' },
  linkBold: { color: PRIMARY, fontWeight: '600' },
});
