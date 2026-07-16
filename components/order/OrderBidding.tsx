import { Feather } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography, shadows } from '../../lib/theme';
import PrimaryButton from '../ui/PrimaryButton';
import Avatar from '../ui/Avatar';

// ─── Types ───────────────────────────────────────────────────────────────────

type Acceptance = {
  id: string;
  provider_id: string;
  accepted_at: string;
  provider_total: number;
  avgRating: number | null;
  reviewCount: number;
  avgDeliveryMinutes: number | null;
  provider: {
    full_name: string;
    business_name: string | null;
    phone: string;
    avatar_url: string | null;
  } | null;
};

type SortBy = 'price' | 'distance';
type PaymentMethod = 'cash' | 'card';
type PaymentSettings = { allow_cash_payment: boolean; allow_card_payment: boolean } | null;

export type OrderBiddingProps = {
  // Data
  showAcceptances: boolean;
  acceptances: Acceptance[];
  sortBy: SortBy;
  sortDropdownOpen: boolean;
  selectedProviderId: string | null;
  pendingProviderId: string | null;
  paymentMethod: PaymentMethod | null;
  paymentSettings: PaymentSettings;
  selectingProvider: string | null;
  // When set, provider cards surface an express-priority ETA hint. Optional:
  // call sites for non-express orders simply omit it.
  isExpress?: boolean;
  // When true, the internal "Select Provider" button is not rendered (the host
  // screen provides its own, e.g. a pinned bottom bar).
  hideSelectButton?: boolean;

  // Callbacks
  onToggleSortDropdown: () => void;
  onSetSortBy: (key: SortBy) => void;
  onSelectCard: (providerId: string) => void;
  onOpenPayment: () => void;
  onSetPaymentMethod: (method: PaymentMethod) => void;
  onConfirmSelection: () => void;
  onClosePayment: () => void;
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function OrderBidding({
  showAcceptances,
  acceptances,
  sortBy,
  sortDropdownOpen,
  selectedProviderId,
  pendingProviderId,
  paymentMethod,
  paymentSettings,
  selectingProvider,
  isExpress = false,
  hideSelectButton = false,
  onToggleSortDropdown,
  onSetSortBy,
  onSelectCard,
  onOpenPayment,
  onSetPaymentMethod,
  onConfirmSelection,
  onClosePayment,
}: OrderBiddingProps) {
  const insets = useSafeAreaInsets();

  return (
    <>
      {/* Provider acceptances */}
      {showAcceptances && (
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Providers</Text>
            {acceptances.length > 0 && (
              <View>
                <TouchableOpacity
                  style={styles.sortDropdownBtn}
                  onPress={onToggleSortDropdown}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sortDropdownBtnText}>
                    {sortBy === 'price' ? 'Price' : 'Distance'}
                  </Text>
                  <Feather
                    name={sortDropdownOpen ? 'chevron-up' : 'chevron-down'}
                    size={15}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
                {sortDropdownOpen && (
                  <View style={styles.sortDropdownMenu}>
                    {(['price', 'distance'] as const).map((key) => (
                      <TouchableOpacity
                        key={key}
                        style={[styles.sortDropdownItem, sortBy === key && styles.sortDropdownItemActive]}
                        onPress={() => onSetSortBy(key)}
                      >
                        <Text style={[styles.sortDropdownItemText, sortBy === key && styles.sortDropdownItemTextActive]}>
                          {key === 'price' ? 'Price' : 'Distance'}
                        </Text>
                        {sortBy === key && <Feather name="check" size={14} color={colors.primary} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
          {acceptances.length === 0 ? (
            <View style={styles.emptyProviders}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.emptyProvidersText}>Waiting for providers to accept...</Text>
            </View>
          ) : (
            [...acceptances]
              .sort((a, b) => {
                if (sortBy === 'price') return a.provider_total - b.provider_total;
                // distance: sort by avgRating descending as proxy (no distance data available)
                if (a.avgRating == null && b.avgRating == null) return 0;
                if (a.avgRating == null) return 1;
                if (b.avgRating == null) return -1;
                return b.avgRating - a.avgRating;
              })
              .map((acc) => (
                <ProviderCard
                  key={acc.id}
                  acceptance={acc}
                  selected={selectedProviderId === acc.provider_id}
                  isExpress={isExpress}
                  onSelect={() => onSelectCard(acc.provider_id)}
                />
              ))
          )}

          {!hideSelectButton && (
            <View style={styles.selectButtonWrap}>
              <PrimaryButton
                label="Select provider"
                onPress={onOpenPayment}
                disabled={!selectedProviderId}
              />
            </View>
          )}
        </View>
      )}

      {/* Payment method modal */}
      <Modal
        visible={pendingProviderId !== null}
        animationType="slide"
        transparent
        onRequestClose={onClosePayment}
      >
        <View style={styles.paymentModalOverlay}>
          <View style={[styles.paymentModalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.paymentModalHeader}>
              <Text style={styles.paymentModalTitle}>Choose payment method</Text>
              <TouchableOpacity style={styles.paymentCloseBtn} onPress={onClosePayment} hitSlop={8}>
                <Feather name="x" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.paymentOptions}>
              {paymentSettings?.allow_cash_payment && (
                <TouchableOpacity
                  style={[styles.paymentOption, paymentMethod === 'cash' && styles.paymentOptionSelected]}
                  onPress={() => onSetPaymentMethod('cash')}
                >
                  <View style={[styles.radio, paymentMethod === 'cash' && styles.radioSelected]}>
                    {paymentMethod === 'cash' && <View style={styles.radioDot} />}
                  </View>
                  <Feather
                    name="dollar-sign"
                    size={18}
                    color={paymentMethod === 'cash' ? colors.primary : colors.textSecondary}
                    style={styles.paymentIcon}
                  />
                  <Text style={[styles.paymentLabel, paymentMethod === 'cash' && styles.paymentLabelSelected]}>
                    Cash on Delivery
                  </Text>
                </TouchableOpacity>
              )}
              {paymentSettings?.allow_card_payment && (
                <TouchableOpacity
                  style={[styles.paymentOption, paymentMethod === 'card' && styles.paymentOptionSelected]}
                  onPress={() => onSetPaymentMethod('card')}
                >
                  <View style={[styles.radio, paymentMethod === 'card' && styles.radioSelected]}>
                    {paymentMethod === 'card' && <View style={styles.radioDot} />}
                  </View>
                  <Feather
                    name="credit-card"
                    size={18}
                    color={paymentMethod === 'card' ? colors.primary : colors.textSecondary}
                    style={styles.paymentIcon}
                  />
                  <Text style={[styles.paymentLabel, paymentMethod === 'card' && styles.paymentLabelSelected]}>
                    Card Payment
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <PrimaryButton
              label="Confirm order"
              onPress={onConfirmSelection}
              loading={selectingProvider !== null}
              disabled={!paymentMethod}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Provider card ────────────────────────────────────────────────────────────

function ProviderCard({
  acceptance,
  selected,
  isExpress,
  onSelect,
}: {
  acceptance: Acceptance;
  selected: boolean;
  isExpress: boolean;
  onSelect: () => void;
}) {
  const provider = acceptance.provider;
  const name = provider?.business_name || provider?.full_name || 'Provider';

  return (
    <TouchableOpacity
      style={[styles.providerCard, selected && styles.providerCardSelected]}
      onPress={onSelect}
      activeOpacity={0.8}
    >
      <Avatar
        url={provider?.avatar_url}
        name={name}
        size={46}
        backgroundColor={colors.headerBg}
        textColor={colors.headerAccent}
        style={styles.providerAvatar}
      />
      <View style={styles.providerInfo}>
        <Text style={styles.providerName} numberOfLines={1}>{name}</Text>
        <View style={styles.ratingRow}>
          {acceptance.avgRating !== null ? (
            <>
              <Feather name="star" size={12} color={colors.amber} />
              <Text style={styles.ratingText}>
                {acceptance.avgRating.toFixed(1)}
                <Text style={styles.ratingCount}> ({acceptance.reviewCount})</Text>
              </Text>
            </>
          ) : (
            <Text style={styles.ratingNew}>New</Text>
          )}
          {acceptance.avgDeliveryMinutes !== null && (
            <>
              <Text style={styles.ratingDot}>·</Text>
              <Feather name="clock" size={12} color={colors.textMuted} />
              <Text style={styles.etaText}>~{acceptance.avgDeliveryMinutes} min</Text>
            </>
          )}
        </View>
      </View>
      <View style={styles.providerRight}>
        <Text style={[styles.providerPrice, acceptance.provider_total <= 0 && styles.providerPriceMuted]}>
          {acceptance.provider_total > 0 ? `₱${acceptance.provider_total.toLocaleString()}` : '—'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const H_PADDING = 20;

const styles = StyleSheet.create({
  // Section
  section: { marginBottom: spacing.lg, zIndex: 1 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.sectionHeader, color: colors.text },

  // Sort dropdown
  sortDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  sortDropdownBtnText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  sortDropdownMenu: {
    position: 'absolute',
    top: 40,
    right: 0,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.raised,
    zIndex: 100,
    minWidth: 150,
    overflow: 'hidden',
  },
  sortDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sortDropdownItemActive: { backgroundColor: colors.primaryTint },
  sortDropdownItemText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  sortDropdownItemTextActive: { color: colors.primary, fontWeight: '600' },

  // Empty / waiting state
  emptyProviders: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  emptyProvidersText: { fontSize: 13, color: colors.textMuted },

  // Provider card
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  providerCardSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  providerAvatar: {
    width: 46,
    height: 46,
    borderRadius: radii.pill,
    backgroundColor: colors.headerBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    overflow: 'hidden',
  },
  avatarImage: { width: 46, height: 46, borderRadius: radii.pill },
  providerInitials: { fontSize: 16, fontWeight: '700', color: colors.headerAccent },
  providerInfo: { flex: 1 },
  providerName: { ...typography.cardTitle, color: colors.text },

  // Rating / ETA row
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3, flexWrap: 'wrap' },
  ratingText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  ratingCount: { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  ratingNew: { fontSize: 12, color: colors.textMuted },
  ratingDot: { fontSize: 12, color: colors.border },
  etaText: { fontSize: 11, color: colors.textMuted },

  // Price + selected check
  providerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginLeft: spacing.sm },
  providerPrice: { ...typography.price, color: colors.primary },
  providerPriceMuted: { color: colors.textMuted },

  // Internal Select button (host screens without their own CTA)
  selectButtonWrap: { marginTop: spacing.xs },

  // Payment modal
  paymentModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  paymentModalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: H_PADDING,
    paddingTop: spacing.lg,
  },
  paymentModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  paymentModalTitle: { ...typography.sectionHeader, color: colors.text },
  paymentCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentOptions: { gap: spacing.sm, marginBottom: spacing.lg },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  paymentOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  paymentIcon: { marginRight: spacing.sm },
  paymentLabel: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  paymentLabelSelected: { color: colors.primary, fontWeight: '600' },
});
