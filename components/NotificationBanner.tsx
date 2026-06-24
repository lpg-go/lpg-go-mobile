import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ComponentProps } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Notification, useNotifications } from '../lib/notificationsStore';

const PRIMARY = '#16A34A';

type FeatherName = ComponentProps<typeof Feather>['name'];

// type → Feather icon
const ICON: Record<string, FeatherName> = {
  new_order: 'package',
  dealer_accepted: 'user-check',
  multiple_dealers_accepted: 'users',
  dealer_selected: 'check-circle',
  order_cancelled: 'x-circle',
  in_transit: 'truck',
  awaiting_confirmation: 'check-square',
  delivery_confirmed: 'check-circle',
  low_balance: 'credit-card',
  provider_unavailable: 'alert-circle',
  new_message: 'message-circle',
};

// type → tap destination for non-message events. Routes needing an order use the
// notification's order_id; dealer_selected → provider Incoming (Option B).
function hrefFor(n: Notification) {
  switch (n.type) {
    case 'new_order':
    case 'order_cancelled':
    case 'dealer_selected':
      return '/(provider)';
    case 'delivery_confirmed':
    case 'low_balance':
      return '/(provider)/earnings';
    case 'dealer_accepted':
    case 'multiple_dealers_accepted':
    case 'in_transit':
    case 'awaiting_confirmation':
    case 'provider_unavailable':
      return n.order_id
        ? { pathname: '/(customer)/order/[id]', params: { id: n.order_id } }
        : null;
    default:
      return null;
  }
}

// Global full-bleed in-app banner for actionable notifications (driven by
// notificationsStore). Styled like the old chat message banner.
export default function NotificationBanner() {
  const { bannerNotification, dismissBanner, openChat } = useNotifications();
  const insets = useSafeAreaInsets();

  if (!bannerNotification) return null;
  const n = bannerNotification;

  function handlePress() {
    dismissBanner();
    if (n.type === 'new_message') {
      // Slide up the global ChatModal sheet (same sheet as the order screens),
      // instead of pushing the full-screen chat route. Derive the sender name
      // from the title ("<sender> sent a message") to seed the header instantly.
      if (n.order_id) {
        const senderName = n.title.replace(/ sent a message$/, '').trim();
        openChat(n.order_id, senderName || undefined);
      }
      return;
    }
    const target = hrefFor(n);
    if (target) router.push(target as never);
  }

  return (
    <TouchableOpacity
      style={[styles.banner, { paddingTop: insets.top + 10 }]}
      onPress={handlePress}
      activeOpacity={0.85}
    >
      <Feather name={ICON[n.type] ?? 'bell'} size={16} color="#fff" />
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>{n.title}</Text>
        {n.body ? <Text style={styles.body} numberOfLines={1}>{n.body}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color="#fff" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Full-bleed green bar pinned to the top (matches the old chat msgBanner).
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  textWrap: { flex: 1 },
  title: { fontSize: 13, fontWeight: '700', color: '#fff' },
  body: { fontSize: 12, color: 'rgba(255,255,255,0.92)', marginTop: 1 },
});
