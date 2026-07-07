import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DELIVERY_SPEED_OPTIONS, speedLabel } from '../../lib/reviewSpeed';
import Avatar from '../ui/Avatar';
import { SAFETY_ITEMS } from '../../lib/safety';
import { colors, radii, spacing, typography, shadows } from '../../lib/theme';
import LiveMap from '../LiveMap';
import SheetHeader from '../SheetHeader';
import PrimaryButton from '../ui/PrimaryButton';

// ─── Types ───────────────────────────────────────────────────────────────────

type OrderStatus =
  | 'pending'
  | 'awaiting_dealer_selection'
  | 'in_transit'
  | 'awaiting_confirmation'
  | 'delivered'
  | 'cancelled';

type Order = {
  id: string;
  status: OrderStatus;
  delivery_address: string;
  total_amount: number;
  is_express: boolean;
  express_fee: number;
  eta_minutes: number | null;
  eta_deadline: string | null;
  selected_provider_id: string | null;
  cancelled_by: string | null;
  // Passed through by the parent screen; used only for the payment label.
  payment_method?: string;
};

type OrderItem = {
  id: string;
  quantity: number;
  subtotal: number;
  product: { name: string } | null;
};

type ProviderProfile = {
  id: string;
  full_name: string;
  business_name: string | null;
  phone: string;
  avatar_url: string | null;
  provider_type: 'dealer' | 'rider' | null;
};

type LatLng = { lat: number; lng: number };

type StatusCfg = { label: string; color: string; bg: string };

export type OrderTrackingProps = {
  // Data
  order: Order;
  items: OrderItem[];
  selectedProvider: ProviderProfile | null;
  statusCfg: StatusCfg;
  shortId: string;
  placedAt: string;
  providerLocation: LatLng | null;
  customerLocation: LatLng | null;
  mapVisible: boolean;
  unreadCount: number;

  // Review
  reviewDone: boolean;
  existingRating: number | null;
  existingComment: string | null;
  reviewRating: number;
  reviewComment: string;
  reviewSpeed: string | null;
  existingSpeed: string | null;
  setReviewSpeed: (s: string | null) => void;
  submittingReview: boolean;

  // Safety check (pre-delivery, recorded by rider)
  safetyCheck: { passed: boolean; notes: string | null; checked_at: string } | null;

  // Flags
  confirming: boolean;

  // Slots — bidding list (children) + Cancel button stay owned by the parent
  // screen and are injected here so the scroll order stays identical to the
  // original layout. `children` renders in the bidding scroll position.
  children?: React.ReactNode;
  cancelSlot?: React.ReactNode;

  // Callbacks
  onOpenMap: () => void;
  onCloseMap: () => void;
  onChat: () => void;
  onCall: () => void;
  onConfirmDelivery: () => void;
  onSetReviewRating: (rating: number) => void;
  onSetReviewComment: (comment: string) => void;
  onSubmitReview: () => void;
  onPlaceNewOrder: () => void;
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function OrderTracking({
  order,
  items,
  selectedProvider,
  statusCfg,
  shortId,
  placedAt,
  providerLocation,
  customerLocation,
  mapVisible,
  unreadCount,
  reviewDone,
  existingRating,
  existingComment,
  reviewRating,
  reviewComment,
  reviewSpeed,
  existingSpeed,
  setReviewSpeed,
  submittingReview,
  safetyCheck,
  confirming,
  children,
  cancelSlot,
  onOpenMap,
  onCloseMap,
  onChat,
  onCall,
  onConfirmDelivery,
  onSetReviewRating,
  onSetReviewComment,
  onSubmitReview,
  onPlaceNewOrder,
}: OrderTrackingProps) {
  const insets = useSafeAreaInsets();

  const showSelectedProvider =
    order.selected_provider_id !== null && order.status !== 'cancelled';

  // Timeline progress — how far the order has advanced.
  //   pending / awaiting_dealer_selection → node 1
  //   in_transit                          → nodes 1+2
  //   awaiting_confirmation / delivered   → all nodes
  const stageIndex =
    order.status === 'in_transit'
      ? 1
      : order.status === 'awaiting_confirmation' || order.status === 'delivered'
      ? 2
      : 0;
  const stages: { label: string; icon: keyof typeof Feather.glyphMap; time: string | null }[] = [
    { label: 'Order confirmed', icon: 'check', time: placedAt },
    { label: 'Rider on the way', icon: 'truck', time: null },
    { label: 'Delivered', icon: 'package', time: null },
  ];

  const etaTime = order.eta_deadline
    ? new Date(order.eta_deadline).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
    : null;

  const providerLabel =
    selectedProvider?.business_name || selectedProvider?.full_name || 'Provider';
  const providerInitials = providerLabel
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const methodLabel = order.payment_method === 'card' ? 'Card' : 'Cash on delivery';

  const bottomPad = order.status === 'awaiting_confirmation' ? 96 : 40;

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Status timeline */}
        {order.status !== 'cancelled' && (
          <View style={styles.trackCard}>
            {order.is_express && etaTime && order.eta_minutes != null && (
              <View style={styles.etaRow}>
                <Feather name="zap" size={14} color={colors.amberDark} />
                <Text style={styles.etaText}>
                  Deliver by {etaTime} · ~{order.eta_minutes} min
                </Text>
              </View>
            )}
            {stages.map((stage, i) => {
              const active = i <= stageIndex;
              const isLast = i === stages.length - 1;
              const connectorActive = i < stageIndex;
              return (
                <View key={stage.label} style={styles.timelineRow}>
                  <View style={styles.timelineLeft}>
                    <View style={[styles.node, active ? styles.nodeActive : styles.nodeFuture]}>
                      <Feather name={stage.icon} size={14} color={active ? '#fff' : colors.textFaint} />
                    </View>
                    {!isLast && (
                      <View
                        style={[
                          styles.connector,
                          connectorActive ? styles.connectorActive : styles.connectorFuture,
                        ]}
                      />
                    )}
                  </View>
                  <View style={styles.timelineText}>
                    <Text style={[styles.timelineLabel, !active && styles.timelineLabelFuture]}>
                      {stage.label}
                    </Text>
                    {active && stage.time ? (
                      <Text style={styles.timelineTime}>{stage.time}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
            <View style={styles.trackAddressRow}>
              <Feather name="map-pin" size={14} color={colors.textMuted} />
              <Text style={styles.trackAddressText} numberOfLines={2}>
                {order.delivery_address}
              </Text>
            </View>
          </View>
        )}

        {/* System-expired order notice */}
        {order.status === 'cancelled' && order.cancelled_by === 'system' && (
          <View style={styles.expiredCard}>
            <Feather name="clock" size={32} color={colors.danger} />
            <Text style={styles.expiredTitle}>Order Expired</Text>
            <Text style={styles.expiredSubtitle}>
              Your order expired as no provider accepted it in time.
            </Text>
            <TouchableOpacity style={styles.newOrderBtn} onPress={onPlaceNewOrder}>
              <Text style={styles.newOrderBtnText}>Place New Order</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Confirm delivery — prompt card; the action button is pinned below */}
        {order.status === 'awaiting_confirmation' && (
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconCircle}>
              <Feather name="package" size={26} color={colors.primary} />
            </View>
            <Text style={styles.confirmCardTitle}>Order delivered?</Text>
            <Text style={styles.confirmCardSubtitle}>
              Tap confirm below once you&apos;ve received your order from the rider.
            </Text>
          </View>
        )}

        {/* Safety check result — recorded by the rider before delivery */}
        {(order.status === 'awaiting_confirmation' || order.status === 'delivered') &&
          safetyCheck != null &&
          (safetyCheck.passed ? (
            <View style={styles.safetyCard}>
              <Text style={styles.safetyLabel}>Safety check passed</Text>
              {SAFETY_ITEMS.map((label) => (
                <View key={label} style={styles.safetyItemRow}>
                  <View style={styles.safetyCheckCircle}>
                    <Feather name="check" size={12} color="#fff" />
                  </View>
                  <Text style={styles.safetyItemText}>{label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.safetyCardWarn}>
              <View style={styles.safetyItemRow}>
                <Feather name="alert-triangle" size={18} color={colors.amberDark} />
                <Text style={styles.safetyTitleWarn}>Provider reported an issue</Text>
              </View>
              {safetyCheck.notes ? (
                <Text style={styles.safetyNotesText}>{safetyCheck.notes}</Text>
              ) : null}
            </View>
          ))}

        {/* Provider acceptances (bidding) — owned by the parent screen */}
        {children}

        {/* Selected provider — contact card */}
        {showSelectedProvider && selectedProvider && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Your provider</Text>
            <TouchableOpacity
              style={styles.providerCard}
              activeOpacity={0.8}
              onPress={onOpenMap}
              disabled={order.status !== 'in_transit' || selectedProvider?.provider_type !== 'rider'}
            >
              <Avatar
                url={selectedProvider.avatar_url}
                name={providerLabel}
                size={44}
                backgroundColor={colors.headerBg}
                textColor={colors.headerAccent}
                style={styles.providerAvatar}
              />
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>{providerLabel}</Text>
                <View style={styles.providerMetaRow}>
                  <Feather name="shield" size={12} color={colors.primary} />
                  <Text style={styles.providerBusiness}>LPG Provider</Text>
                </View>
              </View>
              {order.status === 'in_transit' && selectedProvider?.provider_type === 'rider' && (
                <View style={styles.providerActions}>
                  <TouchableOpacity style={styles.actionOutline} onPress={onOpenMap} hitSlop={6} activeOpacity={0.7}>
                    <Feather name="map-pin" size={18} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Payment summary */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Payment · {methodLabel}</Text>
          <View style={styles.itemsCard}>
            {items.map((item, index) => (
              <View
                key={item.id}
                style={[styles.itemRow, index < items.length - 1 && styles.itemRowBorder]}
              >
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.product?.name ?? 'Product'}
                </Text>
                <Text style={styles.itemQty}>×{item.quantity}</Text>
                <Text style={styles.itemSubtotal}>₱{Number(item.subtotal).toLocaleString()}</Text>
              </View>
            ))}
            {order.is_express && (
              <View style={styles.expressFeeRow}>
                <Text style={styles.expressFeeLabel}>Express delivery</Text>
                <Text style={styles.expressFeeValue}>+₱{Number(order.express_fee).toLocaleString()}</Text>
              </View>
            )}
          </View>
          <View style={styles.totalPill}>
            <Text style={styles.totalPillLabel}>Total to pay</Text>
            <Text style={styles.totalPillValue}>₱{Number(order.total_amount).toLocaleString()}</Text>
          </View>
        </View>

        {/* Review — shown after delivery */}
        {order.status === 'delivered' && selectedProvider && (
          reviewDone ? (
            /* Already-reviewed — read-only thank-you summary */
            <View style={styles.reviewDoneCard}>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <MaterialCommunityIcons
                    key={s}
                    name={s <= (existingRating ?? 0) ? 'star' : 'star-outline'}
                    size={20}
                    color={s <= (existingRating ?? 0) ? colors.amber : colors.border}
                  />
                ))}
              </View>
              <Text style={styles.reviewDoneTitle}>Thanks for your review!</Text>
              <Text style={styles.reviewDoneSub}>
                Your feedback keeps providers at their best.
              </Text>
              {existingComment ? (
                <Text style={styles.reviewDoneComment}>&quot;{existingComment}&quot;</Text>
              ) : null}
              {speedLabel(existingSpeed) ? (
                <View style={styles.reviewSpeedPill}>
                  <Text style={styles.reviewSpeedPillText}>
                    Rated delivery: {speedLabel(existingSpeed)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <>
              {/* 1. Star rating */}
              <View style={[styles.reviewCard, styles.reviewCardCentered]}>
                <Text style={styles.reviewCardLabel}>Rate your provider</Text>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity key={s} onPress={() => onSetReviewRating(s)} hitSlop={6} activeOpacity={0.7}>
                      <MaterialCommunityIcons
                        name={s <= reviewRating ? 'star' : 'star-outline'}
                        size={36}
                        color={s <= reviewRating ? colors.amber : colors.border}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* 2. Delivery speed */}
              <View style={styles.reviewCard}>
                <Text style={styles.reviewCardLabel}>Delivery speed</Text>
                <View style={styles.speedRow}>
                  {DELIVERY_SPEED_OPTIONS.map((opt) => {
                    const selected = reviewSpeed === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[styles.speedPill, selected && styles.speedPillSelected]}
                        onPress={() => setReviewSpeed(selected ? null : opt.value)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.speedPillText, selected && styles.speedPillTextSelected]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* 3. Comment */}
              <View style={styles.reviewCard}>
                <Text style={styles.reviewCardLabel}>Add a comment (optional)</Text>
                <TextInput
                  style={styles.reviewInput}
                  placeholder="Tell us about your experience…"
                  placeholderTextColor={colors.textMuted}
                  value={reviewComment}
                  onChangeText={onSetReviewComment}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              {/* 4. Submit */}
              <View style={styles.reviewSubmitWrap}>
                <PrimaryButton
                  label="Submit review"
                  onPress={onSubmitReview}
                  loading={submittingReview}
                />
              </View>
            </>
          )
        )}

        {/* Cancel button — owned by the parent screen */}
        {cancelSlot}
      </ScrollView>

      {/* Pinned confirm-delivery CTA */}
      {order.status === 'awaiting_confirmation' && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <PrimaryButton label="Confirm delivery" onPress={onConfirmDelivery} loading={confirming} />
        </View>
      )}

      {/* Map popup — bottom sheet, like the chat popup */}
      <Modal visible={mapVisible} transparent animationType="slide" onRequestClose={onCloseMap}>
        <View style={styles.mapSheetOverlay}>
          <View style={styles.mapSheet}>
            <SheetHeader
              title={selectedProvider?.business_name || selectedProvider?.full_name || 'Live Tracking'}
              subtitle={`Order #${shortId}`}
              onClose={onCloseMap}
            />
            <View style={styles.mapSheetBody}>
              <LiveMap
                providerLocation={providerLocation}
                customerLocation={customerLocation}
                providerName={selectedProvider?.full_name}
                businessName={selectedProvider?.business_name ?? undefined}
                deliveryAddress={order?.delivery_address}
                avatarUrl={selectedProvider?.avatar_url}
                isExpress={order.is_express}
                onBack={onCloseMap}
                onCall={onCall}
                onChat={onChat}
                // providerHeading: skipped — provider_locations only stores lat/lng (no heading/bearing).
                // rating: skipped — OrderTracking has no provider avgRating (contact card shows "LPG Provider", not a score).
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const H_PADDING = 20;

const styles = StyleSheet.create({
  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg },

  // Status timeline card
  trackCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.amberTint,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  etaText: { fontSize: 13, fontWeight: '700', color: colors.amberDark },

  timelineRow: { flexDirection: 'row' },
  timelineLeft: { alignItems: 'center', width: 28 },
  node: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeActive: { backgroundColor: colors.primary },
  nodeFuture: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.card },
  connector: { width: 2, height: 22 },
  connectorActive: { backgroundColor: colors.primary },
  connectorFuture: { backgroundColor: colors.border },
  timelineText: { flex: 1, marginLeft: spacing.md, paddingTop: 4 },
  timelineLabel: { ...typography.cardTitle, color: colors.text },
  timelineLabelFuture: { color: colors.textFaint, fontWeight: '400' },
  timelineTime: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  trackAddressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  trackAddressText: { flex: 1, ...typography.body, color: colors.textSecondary },

  // System-expired card
  expiredCard: {
    backgroundColor: colors.dangerTint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.xxl,
    gap: spacing.sm,
  },
  expiredTitle: { fontSize: 18, fontWeight: '700', color: colors.danger, marginTop: 4 },
  expiredSubtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  newOrderBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: 28,
  },
  newOrderBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Confirm delivery prompt card
  confirmCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  confirmIconCircle: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  confirmCardTitle: { fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
  confirmCardSubtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },

  // Safety check result
  safetyCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  safetyLabel: { ...typography.label, color: colors.primaryDark, marginBottom: spacing.xs },
  safetyCheckCircle: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyItemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: 2 },
  safetyItemText: { fontSize: 14, color: colors.text },
  safetyCardWarn: {
    backgroundColor: colors.amberTint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.amber,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  safetyTitleWarn: { fontSize: 16, fontWeight: '700', color: colors.amberText },
  safetyNotesText: { fontSize: 14, color: colors.text },

  // Section
  section: { marginBottom: spacing.lg, zIndex: 1 },
  sectionLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },

  // Provider contact card
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  providerAvatar: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.headerBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    overflow: 'hidden',
  },
  avatarImage: { width: 44, height: 44, borderRadius: radii.pill },
  providerInitials: { fontSize: 16, fontWeight: '700', color: colors.headerAccent },
  providerInfo: { flex: 1 },
  providerName: { ...typography.cardTitle, color: colors.text },
  providerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  providerBusiness: { ...typography.caption, color: colors.textSecondary },
  providerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionOutline: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  chatBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },

  // Order items / payment
  itemsCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
    ...shadows.card,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  itemName: { flex: 1, fontSize: 13, color: colors.text },
  itemQty: { fontSize: 13, color: colors.textMuted, marginHorizontal: spacing.md },
  itemSubtotal: { fontSize: 13, fontWeight: '600', color: colors.text, minWidth: 64, textAlign: 'right' },
  expressFeeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  expressFeeLabel: { fontSize: 13, color: colors.amberDark, fontWeight: '600' },
  expressFeeValue: { fontSize: 13, fontWeight: '700', color: colors.amberDark },

  // Green total pill
  totalPill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  totalPillLabel: { fontSize: 14, fontWeight: '700', color: colors.primaryDark },
  totalPillValue: { ...typography.price, color: colors.primaryDark },

  // Pinned bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: H_PADDING,
    paddingTop: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },

  // Review — input cards
  reviewCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  reviewCardCentered: { alignItems: 'center' },
  reviewCardLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  starsRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  reviewInput: {
    width: '100%',
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 14,
    color: colors.text,
    minHeight: 80,
  },
  reviewSubmitWrap: { marginBottom: spacing.lg },

  // Review — already-reviewed summary
  reviewDoneCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  reviewDoneTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  reviewDoneSub: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  reviewDoneComment: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', fontStyle: 'italic' },
  reviewSpeedPill: {
    backgroundColor: colors.primaryTintStrong,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  reviewSpeedPillText: { fontSize: 13, fontWeight: '600', color: colors.primaryDark },

  // Delivery speed pills
  speedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  speedPill: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: '#F3F4F6',
  },
  speedPillSelected: { backgroundColor: colors.primary },
  speedPillText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  speedPillTextSelected: { color: '#fff' },

  // Map popup — bottom sheet (matches ChatModal)
  mapSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  mapSheet: {
    height: '92%',
    backgroundColor: '#000',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  mapSheetBody: { flex: 1 },
});
