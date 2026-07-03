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
                  <Feather name={sortDropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color={PRIMARY} />
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
                        {sortBy === key && <Feather name="check" size={13} color={PRIMARY} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
          {acceptances.length === 0 ? (
            <View style={styles.emptyProviders}>
              <ActivityIndicator size="small" color={PRIMARY} />
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
            <TouchableOpacity
              style={[styles.selectProviderButton, !selectedProviderId && styles.selectProviderButtonDisabled]}
              onPress={onOpenPayment}
              disabled={!selectedProviderId}
            >
              <Text style={styles.selectProviderText}>Select Provider</Text>
            </TouchableOpacity>
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
              <Text style={styles.paymentModalTitle}>Choose Payment Method</Text>
              <TouchableOpacity onPress={onClosePayment} hitSlop={8}>
                <Feather name="x" size={22} color="#6B7280" />
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
                    color={paymentMethod === 'cash' ? PRIMARY : '#6B7280'}
                    style={{ marginRight: 10 }}
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
                    color={paymentMethod === 'card' ? PRIMARY : '#6B7280'}
                    style={{ marginRight: 10 }}
                  />
                  <Text style={[styles.paymentLabel, paymentMethod === 'card' && styles.paymentLabelSelected]}>
                    Card Payment
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.confirmOrderBtn,
                (selectingProvider !== null || !paymentMethod) && { opacity: 0.6 },
              ]}
              onPress={onConfirmSelection}
              disabled={selectingProvider !== null || !paymentMethod}
            >
              {selectingProvider !== null ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmOrderBtnText}>Confirm Order</Text>
              )}
            </TouchableOpacity>
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

  return (
    <TouchableOpacity
      style={[styles.providerCard, selected && styles.providerCardSelected]}
      onPress={onSelect}
      activeOpacity={0.8}
    >
      <View style={styles.providerAvatar}>
        {provider?.avatar_url ? (
          <Image source={{ uri: provider.avatar_url }} style={styles.avatarImage} />
        ) : (
          <Feather name="user" size={20} color={PRIMARY} />
        )}
      </View>
      <View style={styles.providerInfo}>
        <Text style={styles.providerName}>
          {provider?.business_name || provider?.full_name || 'Provider'}
        </Text>
        <View style={styles.ratingRow}>
          {acceptance.avgRating !== null ? (
            <>
              <Feather name="star" size={12} color="#FBBF24" />
              <Text style={styles.ratingText}>
                {acceptance.avgRating.toFixed(1)}
                <Text style={styles.ratingCount}> ({acceptance.reviewCount})</Text>
              </Text>
            </>
          ) : (
            <Text style={styles.ratingNew}>New</Text>
          )}
          {isExpress ? (
            <>
              <Text style={styles.ratingDot}>·</Text>
              <Feather name="zap" size={12} color="#B45309" />
              <Text style={styles.expressPriority}>
                {acceptance.avgDeliveryMinutes !== null
                  ? `~${acceptance.avgDeliveryMinutes} mins · Express priority`
                  : 'Express priority'}
              </Text>
            </>
          ) : (
            acceptance.avgDeliveryMinutes !== null && (
              <>
                <Text style={styles.ratingDot}>·</Text>
                <Feather name="clock" size={12} color="#9CA3AF" />
                <Text style={styles.ratingCount}>~{acceptance.avgDeliveryMinutes} mins</Text>
              </>
            )
          )}
        </View>
      </View>
      <Text style={styles.providerPriceText}>
        {acceptance.provider_total > 0 ? `₱${acceptance.provider_total.toLocaleString()}` : '—'}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const PRIMARY = '#16A34A';
const H_PADDING = 20;

const styles = StyleSheet.create({
  // Section — shared shape with OrderTracking (kept in both intentionally)
  section: { marginBottom: 16, zIndex: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  // Sort dropdown
  sortDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PRIMARY,
    backgroundColor: '#F0FDF4',
  },
  sortDropdownBtnText: { fontSize: 12, fontWeight: '600', color: PRIMARY },
  sortDropdownMenu: {
    position: 'absolute',
    top: 34,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 100,
    minWidth: 130,
    overflow: 'hidden',
  },
  sortDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  sortDropdownItemActive: { backgroundColor: '#F0FDF4' },
  sortDropdownItemText: { fontSize: 13, fontWeight: '500', color: '#374151' },
  sortDropdownItemTextActive: { color: PRIMARY, fontWeight: '600' },

  // Provider acceptances
  emptyProviders: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyProvidersText: { fontSize: 13, color: '#6B7280' },
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  providerCardSelected: {
    borderColor: PRIMARY,
    backgroundColor: '#F0FDF4',
  },

  // Provider avatar/info — shared shape with OrderTracking (kept in both)
  providerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  avatarImage: { width: 40, height: 40, borderRadius: 20 },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 14, fontWeight: '600', color: '#111827' },

  // Ratings
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3, flexWrap: 'wrap' },
  ratingText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  ratingCount: { fontSize: 11, fontWeight: '400', color: '#9CA3AF' },
  expressPriority: { fontSize: 11, fontWeight: '600', color: '#B45309' },
  ratingNew: { fontSize: 12, color: '#9CA3AF' },
  ratingDot: { fontSize: 12, color: '#D1D5DB' },

  // Price text (plain, not a button) — matches Find Provider
  providerPriceText: { fontSize: 15, fontWeight: '700', color: PRIMARY, marginLeft: 12 },

  // Select Provider button (below the providers list)
  selectProviderButton: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    marginTop: 4,
  },
  selectProviderButtonDisabled: { opacity: 0.5 },
  selectProviderText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Payment modal
  paymentModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  paymentModalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: H_PADDING,
    paddingTop: 18,
  },
  paymentModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  paymentModalTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  paymentOptions: { gap: 10, marginBottom: 16 },
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
  paymentOptionSelected: {
    borderColor: PRIMARY,
    backgroundColor: '#F0FDF4',
  },
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
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PRIMARY,
  },
  paymentLabel: { fontSize: 14, fontWeight: '500', color: '#374151' },
  paymentLabelSelected: { color: PRIMARY, fontWeight: '600' },

  confirmOrderBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  confirmOrderBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
