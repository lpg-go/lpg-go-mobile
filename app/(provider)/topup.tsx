import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
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
import supabase from '../../lib/supabase';
import { colors, radii, spacing } from '../../lib/theme';

type PaymentMethod = 'gcash' | 'card';

const H_PADDING = 20;
const PRESETS = [100, 200, 500, 1000, 2000, 5000];

export default function TopUpScreen() {
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('gcash');
  const [allowCard, setAllowCard] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    boot();
  }, []);

  async function boot() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    await Promise.all([fetchBalance(user.id), fetchSettings()]);
  }

  async function fetchBalance(uid: string) {
    const { data } = await supabase
      .from('profiles')
      .select('balance')
      .eq('id', uid)
      .single();
    if (data) setBalance(Number(data.balance));
  }

  async function fetchSettings() {
    const { data } = await supabase
      .from('platform_settings')
      .select('allow_card_payment')
      .single();
    if (data) setAllowCard(Boolean(data.allow_card_payment));
  }

  function getAmount(): number | null {
    if (customAmount.trim()) {
      const n = parseFloat(customAmount.trim());
      return isNaN(n) ? null : n;
    }
    return selectedPreset;
  }

  function handlePresetPress(amount: number) {
    setSelectedPreset(amount);
    setCustomAmount('');
  }

  function handleCustomAmountChange(text: string) {
    setCustomAmount(text.replace(/[^0-9.]/g, ''));
    setSelectedPreset(null);
  }

  async function handleProceed() {
    const amount = getAmount();

    if (!amount || amount < 50) {
      Alert.alert('Invalid Amount', 'Minimum top-up amount is 50.');
      return;
    }

    if (!userId) return;

    processTopUp(amount);
  }

  // Online top-up is not wired to a payment processor yet (PayMongo integration
  // pending). Until then we must NOT credit the balance — doing so would let a
  // provider give themselves free balance. Show a "coming soon" notice instead.
  // The amount/method UI above is kept intact so PayMongo can be wired in here
  // later: create a payment/checkout, then credit the balance only after the
  // payment webhook confirms.
  async function processTopUp(_amount: number) {
    Alert.alert(
      'Coming Soon',
      'Online top-up is coming soon. Please contact admin to add balance.',
      [{ text: 'OK' }]
    );
  }

  const amount = getAmount();
  const isValidAmount = amount !== null && amount >= 50;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.screen}>
        <DetailHeader
          title="Top Up Balance"
          onBack={() => router.replace('/(provider)')}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Coming soon banner — honest state, no dead-end */}
          <View style={styles.comingSoon}>
            <Feather name="clock" size={18} color={colors.amberText} />
            <View style={styles.comingSoonText}>
              <Text style={styles.comingSoonTitle}>Online top-up is coming soon</Text>
              <Text style={styles.comingSoonSub}>Contact admin to add balance to your account for now.</Text>
            </View>
          </View>

          {/* Current balance */}
          <Card style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Current balance</Text>
            <Text style={styles.balanceValue}>
              {balance != null ? `₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 0 })}` : '—'}
            </Text>
          </Card>

          {/* Amount selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Amount</Text>
            <View style={styles.presetGrid}>
              {PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset}
                  style={[styles.presetBtn, selectedPreset === preset && styles.presetBtnSelected]}
                  onPress={() => handlePresetPress(preset)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.presetText, selectedPreset === preset && styles.presetTextSelected]}>
                    ₱{preset.toLocaleString('en-PH')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.orLabel}>or enter custom amount</Text>

            <View style={[styles.customInputWrap, customAmount.length > 0 && styles.customInputWrapActive]}>
              <Text style={styles.pesoSign}>₱</Text>
              <TextInput
                style={styles.customInput}
                value={customAmount}
                onChangeText={handleCustomAmountChange}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={styles.minNote}>Minimum top-up: ₱50</Text>
          </View>

          {/* Payment method */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Payment Method</Text>
            <View style={styles.paymentOptions}>
              <PaymentOption
                label="GCash"
                sub="Pay via GCash e-wallet"
                icon="smartphone"
                selected={paymentMethod === 'gcash'}
                onPress={() => setPaymentMethod('gcash')}
              />
              {allowCard && (
                <PaymentOption
                  label="Card"
                  sub="Visa / Mastercard"
                  icon="credit-card"
                  selected={paymentMethod === 'card'}
                  onPress={() => setPaymentMethod('card')}
                />
              )}
            </View>
          </View>

          {/* Info note */}
          <Card style={styles.infoBox}>
            <Feather name="info" size={14} color={colors.textSecondary} style={{ marginTop: 1 }} />
            <Text style={styles.infoText}>
              Your balance is used to accept orders. Admin fees are automatically deducted after each successful delivery. ₱1 is equal to 1 credit.
            </Text>
          </Card>
        </ScrollView>

        {/* Bottom bar */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <PrimaryButton
            label={isValidAmount ? `Request ₱${amount!.toLocaleString('en-PH', { minimumFractionDigits: 0 })}` : 'Request Top-Up'}
            onPress={handleProceed}
            disabled={!isValidAmount}
            loading={processing}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function PaymentOption({
  label,
  sub,
  icon,
  selected,
  onPress,
}: {
  label: string;
  sub: string;
  icon: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.paymentOption, selected && styles.paymentOptionSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <Feather
        name={icon as keyof typeof Feather.glyphMap}
        size={18}
        color={selected ? colors.primary : colors.textSecondary}
        style={{ marginRight: 10 }}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.paymentLabel, selected && styles.paymentLabelSelected]}>{label}</Text>
        <Text style={styles.paymentSub}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg },

  // Coming soon banner
  comingSoon: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.amberTint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  comingSoonText: { flex: 1 },
  comingSoonTitle: { fontSize: 14, fontWeight: '700', color: colors.amberText },
  comingSoonSub: { fontSize: 12, color: colors.amberText, marginTop: 2, lineHeight: 17 },

  // Current balance card
  balanceCard: { padding: spacing.lg, marginBottom: spacing.xl, alignItems: 'flex-start' },
  balanceLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  balanceValue: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 4 },

  // Section
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.md },

  // Preset grid
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  presetBtn: {
    width: '31%',
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  presetBtnSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  presetText: { fontSize: 15, fontWeight: '600', color: colors.grey700 },
  presetTextSelected: { color: colors.primaryDark },

  // Custom amount
  orLabel: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.md },
  customInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: 6,
  },
  customInputWrapActive: { borderColor: colors.primary },
  pesoSign: { fontSize: 18, fontWeight: '700', color: colors.grey700, marginRight: 6 },
  customInput: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text, padding: 0 },
  minNote: { fontSize: 12, color: colors.textMuted },

  // Payment options
  paymentOptions: { gap: spacing.sm },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  paymentOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.grey300,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  paymentLabel: { fontSize: 14, fontWeight: '500', color: colors.grey700 },
  paymentLabelSelected: { color: colors.primary, fontWeight: '600' },
  paymentSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },

  // Info box
  infoBox: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  infoText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 19 },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: H_PADDING,
    paddingTop: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.grey100,
  },
});
