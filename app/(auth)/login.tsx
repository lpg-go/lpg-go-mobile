import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { registerForPushNotificationsAsync } from '../../lib/notifications';
import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
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
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

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
        {/* TOP WHITE ZONE — flexible, shrinks when keyboard is up */}
        <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {/* BOTTOM WHITE SHEET */}
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.heading}>Sign in</Text>

          {/* Phone — floating label */}
          <View
            style={[
              styles.field,
              { borderColor: phoneFocused ? colors.primary : colors.border },
            ]}
          >
            <Text
              style={[
                styles.floatingLabel,
                { color: phoneFocused ? colors.primary : colors.textMuted },
              ]}
            >
              Phone number
            </Text>
            <Text style={styles.prefix}>🇵🇭 +63</Text>
            <TextInput
              style={styles.input}
              placeholder="9XX XXX XXXX"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={10}
              value={phone}
              onChangeText={handlePhoneChange}
              onFocus={() => setPhoneFocused(true)}
              onBlur={() => setPhoneFocused(false)}
            />
          </View>

          {/* Password — floating label */}
          <View
            style={[
              styles.field,
              { borderColor: passwordFocused ? colors.primary : colors.border },
            ]}
          >
            <Text
              style={[
                styles.floatingLabel,
                { color: passwordFocused ? colors.primary : colors.textMuted },
              ]}
            >
              Password
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
            />
            <TouchableOpacity
              onPress={() => setShowPassword((v) => !v)}
              style={styles.eyeButton}
              hitSlop={8}
            >
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => router.push('/(auth)/forgot-password')}
            hitSlop={6}
            style={styles.forgotWrap}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          {error ? (
            <View style={styles.errorCard}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton label="Sign In" onPress={handleSignIn} loading={loading} />

          <View style={styles.createRow}>
            <Text style={styles.createMuted}>New here? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')} hitSlop={6}>
              <Text style={styles.createBold}>Create account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white, overflow: 'hidden' },
  flex: { flex: 1 },

  // TOP WHITE ZONE — flex:1 fills the space above the sheet; content centered.
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  logo: { width: '95%', height: 175 },

  // BOTTOM WHITE SHEET — rounded top, lifts gently over the logo area.
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderTopColor: colors.grey100,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 8,
  },
  heading: { fontSize: 19, fontWeight: '700', color: colors.text, marginBottom: spacing.xl },

  // Floating-label field — position relative so the label can notch the border.
  field: {
    position: 'relative',
    backgroundColor: colors.grey50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 15,
    marginBottom: spacing.lg,
  },
  floatingLabel: {
    position: 'absolute',
    top: -8,
    left: 12,
    paddingHorizontal: 4,
    backgroundColor: colors.card,
    fontSize: 12,
    fontWeight: '600',
  },
  prefix: { fontSize: 15, color: colors.text },
  input: { flex: 1, fontSize: 15, color: colors.text, padding: 0 },
  eyeButton: { paddingLeft: spacing.sm },

  forgotWrap: { alignSelf: 'flex-end', marginBottom: spacing.lg },
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

  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  createMuted: { fontSize: 14, color: colors.textSecondary },
  createBold: { fontSize: 14, color: colors.primary, fontWeight: '700' },
});
