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
import * as WebBrowser from 'expo-web-browser';

import Card from '../../components/ui/Card';
import DetailHeader from '../../components/ui/DetailHeader';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { peso } from '../../lib/format';
import supabase from '../../lib/supabase';
import { colors, radii, spacing } from '../../lib/theme';

type PaymentMethod = 'gcash' | 'paymaya' | 'card';

const H_PADDING = 20;
const PRESETS = [500, 1000, 5000];
const MIN_FALLBACK = 300;
const MAX_FALLBACK = 50000;
const FUNCTIONS_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1';

export default function TopUpScreen() {
  const insets = useSafeAreaInsets();

  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('gcash');
  const [settings, setSettings] = useState<{
    feeRate: Record<PaymentMethod, number>;
    feeFixedCard: number;
    allow: Record<PaymentMethod, boolean>;
    min: number;
    max: number;
  } | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    boot();
  }, []);

  async function boot() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await fetchSettings();
  }

  async function fetchSettings() {
    const { data } = await supabase
      .from('platform_settings')
      .select('fee_rate_gcash, fee_rate_maya, fee_rate_card, fee_fixed_card, allow_gcash_topup, allow_maya_topup, allow_card_topup, topup_min_amount, topup_max_amount')
      .single();
    if (!data) return;
    setSettings({
      feeRate: { gcash: Number(data.fee_rate_gcash), paymaya: Number(data.fee_rate_maya), card: Number(data.fee_rate_card) },
      feeFixedCard: Number(data.fee_fixed_card),
      allow: { gcash: data.allow_gcash_topup, paymaya: data.allow_maya_topup, card: data.allow_card_topup },
      min: Number(data.topup_min_amount) || MIN_FALLBACK,
      max: Number(data.topup_max_amount) || MAX_FALLBACK,
    });
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
    setCustomAmount(String(amount)); // auto-fill the amount box with the selected preset
  }

  function handleCustomAmountChange(text: string) {
    setCustomAmount(text.replace(/[^0-9.]/g, ''));
    setSelectedPreset(null);
  }

  async function handleProceed() {
    const amount = getAmount();
    const min = settings?.min ?? MIN_FALLBACK;
    if (!amount || amount < min) {
      Alert.alert('Invalid Amount', `Minimum top-up amount is ${peso(min)}.`);
      return;
    }
    const max = settings?.max ?? MAX_FALLBACK;
    if (amount > max) {
      Alert.alert('Invalid Amount', `Maximum top-up amount is ${peso(max)}.`);
      return;
    }
    setProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { Alert.alert('Session expired', 'Please log in again.'); return; }

      const res = await fetch(`${FUNCTIONS_URL}/create-topup-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ base_amount: amount, method: paymentMethod }),
      });
      const json = await res.json();
      if (!res.ok || !json.checkout_url || !json.topup_id) {
        Alert.alert('Top-up failed', json.error ?? 'Could not start payment.');
        return;
      }

      await WebBrowser.openAuthSessionAsync(json.checkout_url, 'lpg-go://topup');

      // Regardless of the result type (success/cancel/dismiss), the DB status is
      // the source of truth — a paid top-up can return as 'dismiss'. Poll THIS row.
      await pollForCredit(json.topup_id);
    } catch (e) {
      Alert.alert('Top-up failed', 'Network error. If you completed payment, your balance will update shortly.');
    } finally {
      setProcessing(false);
    }
  }

  async function pollForCredit(topupId: string) {
    for (let i = 0; i < 10; i++) {          // ~10 × 1.5s = 15s
      const { data } = await supabase
        .from('topups')
        .select('status')
        .eq('id', topupId)
        .single();
      if (data?.status === 'paid') {
        Alert.alert('Top-up successful', 'Your balance has been updated.');
        return;
      }
      if (data?.status === 'failed') {
        Alert.alert('Top-up failed', 'The payment could not be verified. You were not charged for credit.');
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    Alert.alert('Still confirming', 'If you completed payment, your balance will update shortly.');
  }

  function computeCharge(base: number, method: PaymentMethod): { charge: number; fee: number } | null {
    if (!settings) return null;
    const baseC = Math.round(base * 100);
    if (baseC / 100 !== base) return null;
    const fixedC = method === 'card' ? Math.round(settings.feeFixedCard * 100) : 0;
    const rate = settings.feeRate[method];
    if (!(rate >= 0 && rate < 1)) return null;
    const chargeC = Math.ceil((baseC + fixedC) / (1 - rate) / 100) * 100;  // round UP to whole peso (mirror server)
    return { charge: chargeC / 100, fee: (chargeC - baseC) / 100 };
  }

  const amount = getAmount();
  const isValidAmount = amount !== null && amount >= (settings?.min ?? MIN_FALLBACK);

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
                    {peso(preset)}
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
            <Text style={styles.minNote}>Minimum top-up: {peso(settings?.min ?? MIN_FALLBACK)}</Text>
          </View>

          {/* Payment method */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Payment Method</Text>
            <View style={styles.paymentOptions}>
              {settings?.allow.gcash !== false && (
                <PaymentOption label="GCash" sub="Pay via GCash e-wallet" icon="smartphone"
                  selected={paymentMethod === 'gcash'} onPress={() => setPaymentMethod('gcash')} />
              )}
              {settings?.allow.paymaya && (
                <PaymentOption label="Maya" sub="Pay via Maya e-wallet" icon="smartphone"
                  selected={paymentMethod === 'paymaya'} onPress={() => setPaymentMethod('paymaya')} />
              )}
              {settings?.allow.card && (
                <PaymentOption label="Card" sub="Visa / Mastercard / debit" icon="credit-card"
                  selected={paymentMethod === 'card'} onPress={() => setPaymentMethod('card')} />
              )}
            </View>
          </View>

          {isValidAmount && settings && (() => {
            const c = computeCharge(amount!, paymentMethod);
            return c ? (
              <Card style={styles.infoBox}>
                <Feather name="info" size={14} color={colors.textSecondary} style={{ marginTop: 1 }} />
                <Text style={styles.infoText}>
                  You'll pay {peso(c.charge)} ({peso(amount!)} + {peso(c.fee)} fee). ₱1 = 1 credit; the full {peso(amount!)} is added to your balance.
                </Text>
              </Card>
            ) : null;
          })()}

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
            label={isValidAmount ? `Request ${peso(amount!)}` : 'Request Top-Up'}
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
