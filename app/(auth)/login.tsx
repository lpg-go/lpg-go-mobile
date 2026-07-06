import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { registerForPushNotificationsAsync } from '../../lib/notifications';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PrimaryButton from '../../components/ui/PrimaryButton';
import { formatPhoneAsEmail } from '../../lib/auth';
import supabase from '../../lib/supabase';
import { colors, radii, spacing } from '../../lib/theme';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Keep digits only, drop any leading 0 (the national trunk prefix — "+63" is
  // already shown), and cap at 10 digits, so "0917..." becomes "917..." and the
  // value matches what auth expects after +63 is prepended.
  function handlePhoneChange(text: string) {
    setPhone(text.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10));
  }

  async function handleSignIn() {
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
    if (!password) {
      setError('Enter your password.');
      return;
    }

    const phoneAsEmail = formatPhoneAsEmail(`+63${digits}`);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: phoneAsEmail,
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    registerForPushNotificationsAsync();
    // Root layout handles redirect once session is set
  }

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* HERO — pure green immersive space above the form */}
          <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]} />

          {/* FORM — compact bottom ~⅓ */}
          <View style={[styles.form, { paddingBottom: insets.bottom + spacing.xl }]}>
            <View style={styles.inputCard}>
              <Text style={styles.prefix}>🇵🇭 +63</Text>
              <TextInput
                style={styles.input}
                placeholder="9XX XXX XXXX"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={10}
                value={phone}
                onChangeText={handlePhoneChange}
              />
            </View>

            <View style={styles.inputCard}>
              <Feather name="lock" size={18} color={colors.primary} />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeButton} hitSlop={8}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {error ? (
              <View style={styles.errorCard}>
                <Feather name="alert-circle" size={14} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <PrimaryButton label="Sign In" onPress={handleSignIn} loading={loading} />

            <View style={styles.bottomLinks}>
              <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')} hitSlop={6}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/(auth)/register')} hitSlop={6}>
                <Text style={styles.createBold}>Create account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.headerBg, overflow: 'hidden' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  // HERO — flex:1 pushes the form down; pure green immersive space
  hero: { flex: 1 },

  // FORM — compact light sheet rising over the green hero
  form: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    marginBottom: spacing.md,
  },
  prefix: { fontSize: 15, color: colors.textMuted },
  input: { flex: 1, fontSize: 15, color: colors.text, padding: 0 },
  eyeButton: { paddingLeft: spacing.sm },

  forgotText: { fontSize: 14, color: colors.primary, fontWeight: '600' },

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

  bottomLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  createBold: { fontSize: 14, color: colors.primary, fontWeight: '700' },
});
