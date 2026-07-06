import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Notification, useNotifications } from '../lib/notificationsStore';
import { colors, radii, spacing, typography } from '../lib/theme';

type Props = {
  // When set, the header's back control navigates to this route (Home).
  // When omitted (provider fallback), it falls back to router.back().
  homeHref?: '/(customer)' | '/(provider)';
};

// Maps a notification type to its icon + tinted circle colors. Covers the
// common types and falls back to a gray bell for anything unknown. `lib`
// selects the icon set (Feather by default; MaterialCommunityIcons for wallet).
type NotifIcon = { lib: 'feather' | 'mci'; icon: string; bg: string; color: string };

function getNotifIcon(type: string): NotifIcon {
  const t = (type || '').toLowerCase();
  if (t === 'dealer_selected' || t === 'accepted' || t === 'provider')
    return { lib: 'feather', icon: 'check', bg: colors.primaryTint, color: colors.primary };
  if (t === 'new_order')
    return { lib: 'feather', icon: 'package', bg: '#DBEAFE', color: '#185FA5' };
  if (t === 'in_transit' || t === 'on_the_way')
    return { lib: 'feather', icon: 'truck', bg: colors.primaryTint, color: colors.primary };
  if (t === 'delivered')
    return { lib: 'feather', icon: 'check-circle', bg: colors.primaryTint, color: colors.primary };
  if (t === 'review' || t === 'rate')
    return { lib: 'feather', icon: 'star', bg: colors.amberTint, color: colors.amberDark };
  if (t === 'balance' || t === 'topup' || t === 'payment')
    return { lib: 'mci', icon: 'wallet', bg: colors.primaryTint, color: colors.primary };
  if (t === 'promo' || t === 'welcome')
    return { lib: 'feather', icon: 'gift', bg: '#EDE9FE', color: '#5B21B6' };
  return { lib: 'feather', icon: 'bell', bg: colors.border, color: colors.textSecondary };
}

export default function NotificationsScreen({ homeHref }: Props) {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const insets = useSafeAreaInsets();

  function handleTap(n: Notification) {
    if (!n.is_read) markAsRead(n.id);
    // 'dealer_selected' is sent to BOTH the chosen provider ('You Were Selected!')
    // and the passed-over providers ('Order Taken') — same type + order_id. Only
    // the chosen provider can open the active order, so gate on the title; the
    // 'Order Taken' notification is read-only. (Titles set in the
    // order-notifications edge function, handleDealerSelected.)
    if (n.type === 'dealer_selected' && n.order_id && n.title === 'You Were Selected!') {
      router.push({ pathname: '/(provider)/active/[id]', params: { id: n.order_id } });
    }
  }

  // Back control preserves the original nav intent: go Home when a homeHref is
  // provided (customer + provider hosts), else fall back to router.back().
  function handleBack() {
    if (homeHref) router.push(homeHref);
    else router.back();
  }

  return (
    <View style={styles.screen}>
      {/* Dark header — single row: back control + title + "Mark all read". */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={handleBack}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <Feather name="chevron-left" size={22} color={colors.headerText} />
          </TouchableOpacity>

          <Text style={styles.headerTitle} numberOfLines={1}>
            Notifications
          </Text>

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
      </View>

      {notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="bell-off" size={40} color={colors.textFaint} />
          <Text style={styles.emptyText}>No notifications yet</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const meta = getNotifIcon(item.type);
            return (
              <TouchableOpacity
                style={[styles.card, item.is_read ? styles.cardRead : styles.cardUnread]}
                onPress={() => handleTap(item)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconCircle, { backgroundColor: meta.bg }]}>
                  {meta.lib === 'mci' ? (
                    <MaterialCommunityIcons name={meta.icon as never} size={18} color={meta.color} />
                  ) : (
                    <Feather name={meta.icon as never} size={18} color={meta.color} />
                  )}
                </View>

                <View style={styles.cardContent}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {!item.is_read && <View style={styles.unreadDot} />}
                  </View>
                  <Text style={styles.cardBody} numberOfLines={3}>
                    {item.body}
                  </Text>
                  <Text style={styles.cardTime}>{timeAgo(item.created_at)}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
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
  screen: { flex: 1, backgroundColor: colors.bg },

  // Dark header
  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.headerSurface,
    borderWidth: 1,
    borderColor: colors.headerSurfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...typography.sectionHeader, color: colors.headerText, flex: 1 },

  markAllText: { fontSize: 13, fontWeight: '500', color: colors.headerAccent },
  markAllTextDisabled: { color: colors.headerSubtext },

  // List
  listContent: { padding: spacing.lg, gap: spacing.sm },

  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardUnread: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primaryTintBorder,
  },
  cardRead: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
  },

  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cardContent: { flex: 1 },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 14, fontWeight: '500', color: colors.text, flex: 1 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  cardBody: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginBottom: 6 },
  cardTime: { fontSize: 11, color: colors.textMuted },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyText: { fontSize: 15, color: colors.textMuted },
});
