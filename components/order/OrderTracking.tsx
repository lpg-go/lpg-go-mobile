import { Feather } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
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

import LiveMap from '../LiveMap';

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
  selected_provider_id: string | null;
  cancelled_by: string | null;
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
  newMsgBanner: string | null;

  // Review
  reviewDone: boolean;
  existingRating: number | null;
  existingComment: string | null;
  reviewRating: number;
  reviewComment: string;
  submittingReview: boolean;

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
  newMsgBanner,
  reviewDone,
  existingRating,
  existingComment,
  reviewRating,
  reviewComment,
  submittingReview,
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

  return (
    <>
      {/* New message banner */}
      {newMsgBanner && (
        <TouchableOpacity style={styles.msgBanner} onPress={onChat} activeOpacity={0.85}>
          <Feather name="message-circle" size={14} color="#fff" />
          <Text style={styles.msgBannerText} numberOfLines={1}>{newMsgBanner}</Text>
          <Feather name="chevron-right" size={14} color="#fff" />
        </TouchableOpacity>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Status card */}
        <View style={styles.statusCard}>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusCfg.color }]}>
              {statusCfg.label}
            </Text>
          </View>
          <Text style={styles.orderId}>Order #{shortId}</Text>
          <Text style={styles.placedAt}>Placed {placedAt}</Text>
          <View style={styles.addressRow}>
            <Text style={styles.addressText} numberOfLines={2}>{order.delivery_address}</Text>
          </View>
        </View>

        {/* System-expired order notice */}
        {order.status === 'cancelled' && order.cancelled_by === 'system' && (
          <View style={styles.expiredCard}>
            <Feather name="clock" size={32} color="#DC2626" />
            <Text style={styles.expiredTitle}>Order Expired</Text>
            <Text style={styles.expiredSubtitle}>
              Your order expired as no provider accepted it in time.
            </Text>
            <TouchableOpacity style={styles.newOrderBtn} onPress={onPlaceNewOrder}>
              <Text style={styles.newOrderBtnText}>Place New Order</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Confirm delivery — shown prominently when provider has marked as delivered */}
        {order.status === 'awaiting_confirmation' && (
          <View style={styles.confirmCard}>
            <Feather name="check-circle" size={32} color={PRIMARY} />
            <Text style={styles.confirmCardTitle}>Your order has been delivered!</Text>

            <TouchableOpacity
              style={[styles.confirmBtn, confirming && { opacity: 0.6 }]}
              onPress={onConfirmDelivery}
              disabled={confirming}
            >
              {confirming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmBtnText}>Confirm Delivery</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Provider acceptances (bidding) — owned by the parent screen */}
        {children}

        {/* Selected provider */}
        {showSelectedProvider && selectedProvider && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Provider</Text>
            <TouchableOpacity
              style={styles.selectedProviderCard}
              activeOpacity={0.8}
              onPress={onOpenMap}
              disabled={order.status !== 'in_transit'}
            >
              <View style={styles.providerAvatar}>
                {selectedProvider.avatar_url ? (
                  <Image source={{ uri: selectedProvider.avatar_url }} style={styles.avatarImage} />
                ) : (
                  <Feather name="user" size={22} color={PRIMARY} />
                )}
              </View>
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>{selectedProvider.business_name || selectedProvider.full_name}</Text>
                <Text style={styles.providerBusiness}>
                  {selectedProvider.provider_type === 'rider' ? 'Rider' : 'Dealer'}
                </Text>
              </View>
              {order.status === 'in_transit' && (
                <Feather name="chevron-right" size={20} color={PRIMARY} />
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Order items */}
        <View style={styles.section}>
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
            <View style={styles.itemTotalRow}>
              <Text style={styles.itemTotalLabel}>Total</Text>
              <Text style={styles.itemTotalValue}>₱{Number(order.total_amount).toLocaleString()}</Text>
            </View>
          </View>
        </View>

        {/* Review card — shown after delivery */}
        {order.status === 'delivered' && selectedProvider && (
          <View style={styles.reviewCard}>
            {reviewDone ? (
              <View style={styles.reviewDoneWrap}>
                <Feather name="check-circle" size={20} color={PRIMARY} />
                <Text style={styles.reviewDoneTitle}>Thank you for your review!</Text>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Feather key={s} name="star" size={16} color={s <= (existingRating ?? 0) ? '#FBBF24' : '#E5E7EB'} />
                  ))}
                </View>
                {existingComment ? (
                  <Text style={styles.reviewDoneComment}>"{existingComment}"</Text>
                ) : null}
              </View>
            ) : (
              <>
                <Text style={styles.reviewTitle}>Rate your delivery</Text>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity key={s} onPress={() => onSetReviewRating(s)} hitSlop={6}>
                      <Feather name="star" size={26} color={s <= reviewRating ? '#FBBF24' : '#E5E7EB'} />
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.reviewInput}
                  placeholder="Share your experience (optional)"
                  placeholderTextColor="#9CA3AF"
                  value={reviewComment}
                  onChangeText={onSetReviewComment}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.reviewSubmitBtn, submittingReview && { opacity: 0.6 }]}
                  onPress={onSubmitReview}
                  disabled={submittingReview}
                >
                  {submittingReview
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.reviewSubmitText}>Submit Review</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Cancel button — owned by the parent screen */}
        {cancelSlot}
      </ScrollView>

      {/* Map modal */}
      <Modal visible={mapVisible} animationType="slide" onRequestClose={onCloseMap}>
        <View style={[styles.modalScreen, { paddingTop: insets.top }]}>
          <LiveMap
            providerLocation={providerLocation}
            customerLocation={customerLocation}
            providerName={selectedProvider?.full_name}
            businessName={selectedProvider?.business_name ?? undefined}
            deliveryAddress={order?.delivery_address}
            onBack={onCloseMap}
            onChat={() => { onCloseMap(); onChat(); }}
            onCall={selectedProvider?.phone ? onCall : undefined}
          />
        </View>
      </Modal>
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const PRIMARY = '#16A34A';
const H_PADDING = 20;

const styles = StyleSheet.create({
  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 16 },

  // Message banner
  msgBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  msgBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#fff' },

  // Status card
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginBottom: 12,
  },
  statusBadgeText: { fontSize: 16, fontWeight: '700' },
  orderId: { fontSize: 13, fontWeight: '400', color: '#6B7280', marginBottom: 2 },
  placedAt: { fontSize: 12, color: '#9CA3AF', marginBottom: 10 },
  addressRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
  },
  addressText: { fontSize: 13, fontWeight: '700', color: '#6B7280', flex: 1, textAlign: 'center' },

  // System-expired card
  expiredCard: {
    backgroundColor: '#FFF1F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECDD3',
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  expiredTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#DC2626',
    marginTop: 4,
  },
  expiredSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  newOrderBtn: {
    marginTop: 8,
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  newOrderBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },

  // Confirm delivery card
  confirmCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
    gap: 10,
  },
  confirmCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  confirmBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    marginTop: 4,
  },
  confirmBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Section
  section: { marginBottom: 20, zIndex: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },

  // Selected provider
  selectedProviderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
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
  providerBusiness: { fontSize: 12, color: '#6B7280', marginTop: 1 },

  // Order items
  itemsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  itemName: { flex: 1, fontSize: 13, color: '#374151' },
  itemQty: { fontSize: 13, color: '#9CA3AF', marginHorizontal: 12 },
  itemSubtotal: { fontSize: 13, fontWeight: '600', color: '#111827', minWidth: 64, textAlign: 'right' },
  itemTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  itemTotalLabel: { fontSize: 13, fontWeight: '700', color: '#111827' },
  itemTotalValue: { fontSize: 14, fontWeight: '800', color: PRIMARY },

  // Review card
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
    gap: 8,
  },
  reviewTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  starsRow: { flexDirection: 'row', gap: 6 },
  reviewInput: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#111827',
    minHeight: 56,
  },
  reviewSubmitBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 10,
    width: '100%',
    alignItems: 'center',
  },
  reviewSubmitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  reviewDoneWrap: { alignItems: 'center', gap: 6 },
  reviewDoneTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  reviewDoneComment: { fontSize: 12, color: '#6B7280', textAlign: 'center', fontStyle: 'italic' },

  // Map modal
  modalScreen: { flex: 1, backgroundColor: '#000' },
});
