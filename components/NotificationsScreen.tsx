import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ReactNode } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Notification, useNotifications } from '../lib/notificationsStore';
import AppHeader from './AppHeader';

const PRIMARY = '#16A34A';

type Props = {
  orderRoute?: '/(customer)/order/[id]' | '/(provider)/active/[id]';
  chatRoute?: '/(customer)/chat/[orderId]' | '/(provider)/chat/[orderId]';
  // When set, the header shows a tappable logo (→ this route) + headerRight.
  // When omitted (provider fallback), it shows a back button + "Notifications".
  homeHref?: '/(customer)' | '/(provider)';
  headerRight?: ReactNode;
};

export default function NotificationsScreen({ orderRoute, chatRoute, homeHref, headerRight }: Props) {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();

  function handleTap(n: Notification) {
    if (!n.is_read) markAsRead(n.id);
    // Signup promo credit → provider earnings (no order_id; route before the
    // order_id early return below).
    if (n.type === 'signup_promo') {
      router.push('/(provider)/earnings');
      return;
    }
    if (!n.order_id) return;
    if (n.type === 'new_message' && chatRoute) {
      router.push({ pathname: chatRoute, params: { orderId: n.order_id } });
    } else if (orderRoute) {
      router.push({ pathname: orderRoute, params: { id: n.order_id } });
    }
  }

  return (
    <View style={styles.screen}>
      {homeHref ? (
        <AppHeader showLogo logoHref={homeHref} right={headerRight} />
      ) : (
        <AppHeader showBack title="Notifications" right={headerRight} />
      )}

      {/* Mark all read — moved below the header (no header action slot anymore) */}
      <View style={styles.markAllRow}>
        <TouchableOpacity
          onPress={markAllAsRead}
          disabled={unreadCount === 0}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text
            style={[
              styles.markAllText,
              unreadCount === 0 && styles.markAllTextDisabled,
            ]}
          >
            Mark all read
          </Text>
        </TouchableOpacity>
      </View>

      {notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="bell-off" size={40} color="#D1D5DB" />
          <Text style={styles.emptyText}>No notifications yet</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.item, !item.is_read && styles.itemUnread]}
              onPress={() => handleTap(item)}
              activeOpacity={0.7}
            >
              <View style={styles.itemTop}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {!item.is_read && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.itemBody} numberOfLines={3}>
                {item.body}
              </Text>
              <Text style={styles.itemTime}>{timeAgo(item.created_at)}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 120) return '1 minute ago';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 7200) return '1 hour ago';
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 172800) return '1 day ago';
  if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 5184000) return '1 month ago';
  return `${Math.floor(diff / 2592000)} months ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  markAllRow: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
  },
  markAllText: { fontSize: 13, fontWeight: '600', color: PRIMARY },
  markAllTextDisabled: { color: '#9CA3AF' },

  listContent: { padding: 16, gap: 8 },

  item: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  itemUnread: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 8,
  },
  itemTitle: { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PRIMARY,
  },
  itemBody: { fontSize: 13, color: '#374151', lineHeight: 18, marginBottom: 6 },
  itemTime: { fontSize: 11, color: '#9CA3AF' },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: '#9CA3AF' },
});
