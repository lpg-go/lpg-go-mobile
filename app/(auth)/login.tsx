import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { registerForPushNotificationsAsync } from '../../lib/notifications';
import { useState } from 'react';
import {
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PrimaryButton from '../../components/ui/PrimaryButton';
import { formatPhoneAsEmail } from '../../lib/auth';
import supabase from '../../lib/supabase';
import { colors, radii, spacing } from '../../lib/theme';
import { useAppLogo } from '../../lib/useAppLogo';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { logoUrl } = useAppLogo();
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
      {/* Decorative depth circles (behind content) */}
      <View style={styles.circleTop} pointerEvents="none" />
      <View style={styles.circleLeft} pointerEvents="none" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* HERO — brand-dominant top ~⅔; logo + heading centered vertically */}
          <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
            <View style={styles.logoBox}>
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="contain" />
              ) : (
                <Image source={require('../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
              )}
            </View>
            <Text style={styles.heading}>Welcome</Text>
            <Text style={styles.headingAccent}>back 👋</Text>
            <Text style={styles.subtitle}>Sign in to order LPG in minutes</Text>
          </View>

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

  // Decorative circles
  circleTop: {
    position: 'absolute',
    top: -60,
    right: -50,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(22,163,74,0.25)',
  },
  circleLeft: {
    position: 'absolute',
    top: 300,
    left: -60,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(74,222,128,0.12)',
  },

  // HERO — flex:1 pushes the form down and centers the brand block
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  logo: { width: 50, height: 50 },
  heading: { fontSize: 30, fontWeight: '800', color: colors.headerText, letterSpacing: -0.5, lineHeight: 34 },
  headingAccent: { fontSize: 30, fontWeight: '800', color: colors.headerAccent, letterSpacing: -0.5, lineHeight: 34 },
  subtitle: { fontSize: 14, color: colors.headerSubtext, marginTop: spacing.sm },

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
