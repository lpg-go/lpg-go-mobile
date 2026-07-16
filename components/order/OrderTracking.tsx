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
import { colors, radii, spacing, typography, shadows } from '../../lib/theme';
import LiveMap from '../LiveMap';
import SheetHeader from '../SheetHeader';
import PrimaryButton from '../ui/PrimaryButton';
import OrderItemsCard from './OrderItemsCard';
import OrderStatusTimeline from './OrderStatusTimeline';
import PartyCard from '../ui/PartyCard';

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
  // Nullable: orders are created before the customer picks a payment method.
  payment_method?: string | null;
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

  const providerLabel =
    selectedProvider?.business_name || selectedProvider?.full_name || 'Provider';

  // Call/chat are available once the delivery is live — mirrors the provider
  // screen's "Deliver to" PartyCard gating.
  const contactActive =
    order.status === 'in_transit' || order.status === 'awaiting_confirmation';


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
          <OrderStatusTimeline
            status={order.status}
            placedAt={placedAt}
            deliveryAddress={order.delivery_address}
            isExpress={order.is_express}
            etaDeadline={order.eta_deadline}
            etaMinutes={order.eta_minutes}
            showAddress
          />
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

        {/* Safety check result — only surfaced when the rider reported an issue */}
        {(order.status === 'awaiting_confirmation' || order.status === 'delivered') &&
          safetyCheck != null &&
          !safetyCheck.passed && (
            <View style={styles.safetyCardWarn}>
              <View style={styles.safetyItemRow}>
                <Feather name="alert-triangle" size={18} color={colors.amberDark} />
                <Text style={styles.safetyTitleWarn}>Provider reported an issue</Text>
              </View>
              {safetyCheck.notes ? (
                <Text style={styles.safetyNotesText}>{safetyCheck.notes}</Text>
              ) : null}
            </View>
          )}

        {/* Provider acceptances (bidding) — owned by the parent screen */}
        {children}

        {/* Selected provider — contact card */}
        {showSelectedProvider && selectedProvider && (
          <View style={styles.section}>
            <PartyCard
              name={providerLabel}
              avatarUrl={selectedProvider.avatar_url}
              showAvatar={false}
              subtitle="LPG Provider"
              onCall={contactActive ? onCall : undefined}
              onChat={contactActive ? onChat : undefined}
              chatBadge={unreadCount}
            />
            {order.status === 'in_transit' && selectedProvider.provider_type === 'rider' && (
              <TouchableOpacity style={styles.mapBtn} onPress={onOpenMap} activeOpacity={0.7}>
                <Feather name="map-pin" size={18} color={colors.primary} />
                <Text style={styles.mapBtnText}>Open live map</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Payment summary */}
        <View style={styles.section}>
          <OrderItemsCard
            items={items}
            isExpress={order.is_express}
            expressFee={order.express_fee}
            totalAmount={order.total_amount}
            totalLabel={`Total (${order.payment_method === 'card' ? 'Card' : 'COD'})`}
            totalVariant="row"
          />
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
                    Speed: {speedLabel(existingSpeed)}
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

  // Safety check result (only shown when the rider reported an issue)
  safetyItemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: 2 },
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

  // Open live map button (below the provider card)
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    marginTop: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  mapBtnText: { fontSize: 16, fontWeight: '600', color: colors.primary },

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
