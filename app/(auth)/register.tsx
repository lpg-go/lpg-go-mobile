import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
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

import Card from '../../components/ui/Card';
import DetailHeader from '../../components/ui/DetailHeader';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { formatPhone } from '../../lib/auth';
import supabase from '../../lib/supabase';
import { colors, radii, spacing, typography } from '../../lib/theme';

type Role = 'customer' | 'provider';
type ProviderType = 'dealer' | 'rider';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
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
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  // Provider Compliance & Indemnity Undertaking — admin-editable text/version
  // pulled from platform_settings; acceptance is mandatory for providers and is
  // logged as an audit row after the account is created (in verify-otp).
  const [complianceText, setComplianceText] = useState('');
  const [complianceVersion, setComplianceVersion] = useState(1);
  const [complianceAccepted, setComplianceAccepted] = useState(false);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('compliance_text, compliance_version')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data?.compliance_text) setComplianceText(data.compliance_text);
        if (data?.compliance_version) setComplianceVersion(data.compliance_version);
      });
  }, []);

  // Keep digits only, drop any leading 0 (the national trunk prefix — the "+63"
  // is already shown in the UI), and cap at 10 digits. So "0917..." becomes
  // "917..." automatically and the stored field always matches what the server's
  // normalizePhone expects (639XXXXXXXXX after +63 is prepended).
  function handlePhoneChange(text: string) {
    setPhone(text.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10));
  }

  async function handleRegister() {
    setError('');
    setAlreadyRegistered(false);

    if (!fullName.trim()) { setError('Full name is required.'); return; }
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) { setError('Enter a valid 10-digit phone number.'); return; }
    if (digits[0] !== '9') { setError('Phone number should start with 9 after +63.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (!role) { setError('Please select your role.'); return; }
    if (role === 'provider' && !providerType) { setError('Please select dealer or rider.'); return; }
    if (role === 'provider' && providerType === 'dealer' && !businessName.trim()) {
      setError('Business name is required for dealers.');
      return;
    }
    if (role === 'provider' && !complianceAccepted) {
      setError('Please accept the Provider Compliance & Indemnity Undertaking to continue.');
      return;
    }

    const fullPhone = formatPhone(digits);
    setLoading(true);

    // The duplicate check now lives in the send-otp Edge Function (service-role,
    // bypasses RLS) — it returns 409 'already_registered' before sending an SMS.
    // Account is created only after OTP verification.
    console.log('[send-otp] sending to phone:', fullPhone);
    const res = await fetch(
      'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/send-otp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, purpose: 'register' }),
      }
    );

    const text = await res.text();
    console.log('[send-otp] raw response:', text);

    let json: { success?: boolean; error?: string; message?: string };
    try {
      json = JSON.parse(text);
    } catch {
      setLoading(false);
      setError('Server error: ' + text);
      return;
    }

    setLoading(false);

    if (json.error === 'already_registered') {
      setAlreadyRegistered(true);
      return;
    }

    if (!res.ok || json.error) {
      setError(json.message ?? json.error ?? 'Failed to send OTP. Try again.');
      return;
    }

    router.push({
      pathname: '/(auth)/verify-otp',
      params: {
        action: 'register',
        phone: fullPhone,
        password,
        fullName: fullName.trim(),
        role,
        providerType: providerType ?? '',
        businessName: role === 'provider' && providerType === 'dealer' ? businessName.trim() : '',
        complianceAccepted: role === 'provider' && complianceAccepted ? 'true' : 'false',
        complianceVersion: String(complianceVersion),
        complianceText: role === 'provider' ? complianceText : '',
      },
    });
  }

  // Inline messages: already-registered link, or generic error.
  function renderMessages() {
    if (alreadyRegistered) {
      return (
        <View style={styles.errorCard}>
          <Feather name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorText}>
            This number is already registered.{' '}
            <Text style={styles.errorLink} onPress={() => router.replace('/(auth)/login')}>
              Please log in.
            </Text>
          </Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.errorCard}>
          <Feather name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }
    return null;
  }

  function renderSubmitButton() {
    // Providers must accept compliance before continuing (also gated in validation).
    const disabled = role === 'provider' && !complianceAccepted;
    return (
      <View style={styles.submitWrap}>
        <PrimaryButton
          label="Continue"
          onPress={handleRegister}
          disabled={disabled}
          loading={loading}
        />
      </View>
    );
  }

  // Provider Compliance & Indemnity Undertaking — scrollable legal text plus a
  // mandatory acceptance checkbox. Shown for providers only; gates the submit.
  function renderCompliance() {
    return (
      <Card style={styles.complianceCard}>
        <Text style={styles.complianceHeading}>Provider Compliance & Indemnity Undertaking</Text>
        <ScrollView
          style={styles.complianceTextBox}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <Text style={styles.complianceText}>{complianceText}</Text>
        </ScrollView>
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setComplianceAccepted((v) => !v)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, complianceAccepted && styles.checkboxChecked]}>
            {complianceAccepted && <Feather name="check" size={14} color="#fff" />}
          </View>
          <Text style={styles.checkboxLabel}>
            I have read, understood and affirm compliance.
          </Text>
        </TouchableOpacity>
      </Card>
    );
  }

  // Shared fields collected for every role.
  function renderSharedFields() {
    return (
      <>
        <Text style={styles.fieldLabel}>Full name</Text>
        <TextInput
          style={styles.input}
          placeholder="Juan dela Cruz"
          placeholderTextColor={colors.textMuted}
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />

        <Text style={styles.fieldLabel}>Phone number</Text>
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

        <Text style={styles.fieldLabel}>Password</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.rowInput}
            placeholder="At least 6 characters"
            placeholderTextColor={colors.textMuted}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeButton} hitSlop={8}>
            <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.fieldLabel}>Confirm password</Text>
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
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <DetailHeader
        title="Create account"
        subtitle="Join LPG Go"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'))}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Role selection */}
          <Text style={styles.fieldLabel}>I am a</Text>
          <View style={styles.optionGroup}>
            <RoleOption
              label="I'm a Customer"
              selected={role === 'customer'}
              onPress={() => { setRole('customer'); setProviderType(null); }}
            />
            <RoleOption
              label="I'm a Provider"
              selected={role === 'provider'}
              onPress={() => setRole('provider')}
            />
          </View>

          {/* Provider sub-options */}
          {role === 'provider' && (
            <>
              <Text style={styles.fieldLabel}>Provider type</Text>
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
                  <Text style={styles.fieldLabel}>Business name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Dela Cruz LPG"
                    placeholderTextColor={colors.textMuted}
                    value={businessName}
                    onChangeText={setBusinessName}
                    autoCapitalize="words"
                  />
                </>
              )}
            </>
          )}

          {renderSharedFields()}

          {role === 'provider' && renderCompliance()}

          {renderMessages()}
          {renderSubmitButton()}

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
    </View>
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
      activeOpacity={0.8}
    >
      <Text style={[styles.roleOptionText, selected && styles.roleOptionTextSelected]}>
        {label}
      </Text>
      {selected ? <Feather name="check-circle" size={18} color={colors.primary} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: { paddingHorizontal: spacing.xxl, paddingTop: spacing.lg },

  // Field labels
  fieldLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },

  // White field cards
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.md,
  },
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
    marginBottom: spacing.md,
  },
  prefix: { fontSize: 15, color: colors.textMuted },
  rowInput: { flex: 1, fontSize: 15, color: colors.text, padding: 0 },
  eyeButton: { paddingLeft: spacing.sm },

  // Role options
  optionGroup: { gap: spacing.sm, marginBottom: spacing.sm },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  roleOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  roleOptionText: { fontSize: 15, fontWeight: '500', color: colors.grey700 },
  roleOptionTextSelected: { color: colors.primary, fontWeight: '600' },

  // Compliance (white card)
  complianceCard: { padding: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.md },
  complianceHeading: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  complianceTextBox: {
    maxHeight: 180,
    backgroundColor: colors.grey50,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  complianceText: { fontSize: 13, color: colors.grey700, lineHeight: 19 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start' },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: colors.grey300,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    marginTop: 1,
  },
  checkboxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkboxLabel: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 20 },

  // Error card
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerTint,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorText: { flex: 1, fontSize: 13, color: colors.danger },
  errorLink: { color: colors.primary, fontWeight: '700' },

  submitWrap: { marginTop: spacing.md, marginBottom: spacing.lg },

  linkRow: { alignItems: 'center' },
  linkText: { fontSize: 14, color: colors.textSecondary },
  linkBold: { color: colors.primary, fontWeight: '700' },
});
