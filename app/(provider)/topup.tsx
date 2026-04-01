import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

import supabase from '../../lib/supabase';

type PaymentMethod = 'gcash' | 'card';

const H_PADDING = 20;
const PRIMARY = '#16A34A';
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
      Alert.alert('Invalid Amount', 'Minimum top-up amount is ₱50.');
      return;
    }

    if (!userId) return;

    const methodLabel = paymentMethod === 'gcash' ? 'GCash' : 'Card';

    Alert.alert(
      'Confirm Top Up',
      `Top up ₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })} via ${methodLabel}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => processTopUp(amount) },
      ]
    );
  }

  async function processTopUp(amount: number) {
    setProcessing(true);

    const { error: txError } = await supabase
      .from('transactions')
      .insert({ provider_id: userId, type: 'topup', amount, order_id: null });

    if (txError) {
      setProcessing(false);
      Alert.alert('Error', txError.message);
      return;
    }

    const newBalance = (balance ?? 0) + amount;
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ balance: newBalance })
      .eq('id', userId);

    setProcessing(false);

    if (profileError) {
      Alert.alert('Error', profileError.message);
      return;
    }

    Alert.alert('Success', 'Balance topped up successfully!', [
      { text: 'OK', onPress: () => router.replace('/(provider)/earnings') },
    ]);
  }

  const amount = getAmount();
  const isValidAmount = amount !== null && amount >= 50;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace('/(provider)/earnings')} style={styles.backButton} hitSlop={8}>
            <Feather name="chevron-left" size={26} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Top Up Balance</Text>
          <View style={{ width: 34 }} />
        </View>

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
                placeholder="0.00"
                placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={styles.minNote}>Minimum top-up: ₱50.00</Text>
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
          <View style={styles.infoBox}>
            <Feather name="info" size={14} color="#6B7280" style={{ marginTop: 1 }} />
            <Text style={styles.infoText}>
              Your balance is used to accept orders. Admin fees are automatically deducted after each successful delivery.
            </Text>
          </View>
        </ScrollView>

        {/* Bottom bar */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.paymongoNote}>PayMongo integration coming soon</Text>
          <TouchableOpacity
            style={[styles.proceedBtn, (!isValidAmount || processing) && styles.proceedBtnDisabled]}
            onPress={handleProceed}
            disabled={!isValidAmount || processing}
            activeOpacity={0.8}
          >
            {processing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.proceedBtnText}>
                  {isValidAmount
                    ? `Top Up ₱${amount!.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                    : 'Proceed to Payment'}
                </Text>
              </>
            )}
          </TouchableOpacity>
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
        name={icon as any}
        size={18}
        color={selected ? PRIMARY : '#6B7280'}
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
  screen: { flex: 1, backgroundColor: '#F9FAFB' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PADDING,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: { width: 34 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 16 },

  // Section
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },

  // Preset grid
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  presetBtn: {
    width: '30.5%',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  presetBtnSelected: { borderColor: PRIMARY, backgroundColor: '#F0FDF4' },
  presetText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  presetTextSelected: { color: PRIMARY },

  // Custom amount
  orLabel: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginBottom: 10 },
  customInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  customInputWrapActive: { borderColor: PRIMARY },
  pesoSign: { fontSize: 18, fontWeight: '700', color: '#374151', marginRight: 6 },
  customInput: { flex: 1, fontSize: 18, fontWeight: '600', color: '#111827', padding: 0 },
  minNote: { fontSize: 12, color: '#9CA3AF' },

  // Payment options
  paymentOptions: { gap: 10 },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  paymentOptionSelected: { borderColor: PRIMARY, backgroundColor: '#F0FDF4' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioSelected: { borderColor: PRIMARY },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: PRIMARY },
  paymentLabel: { fontSize: 14, fontWeight: '500', color: '#374151' },
  paymentLabelSelected: { color: PRIMARY, fontWeight: '600' },
  paymentSub: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },

  // Info box
  infoBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 14,
  },
  infoText: { flex: 1, fontSize: 13, color: '#6B7280', lineHeight: 19 },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: H_PADDING,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  paymongoNote: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginBottom: 8 },
  proceedBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proceedBtnDisabled: { opacity: 0.6 },
  proceedBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
