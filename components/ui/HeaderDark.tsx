import { ReactNode } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radii, typography } from '../../lib/theme';
import Avatar from './Avatar';

function defaultGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

type Props = {
  greeting?: string;
  name: string;
  avatarUrl?: string | null;
  onBellPress?: () => void;
  onAvatarPress?: () => void;
  // Unread notification count for the bell badge. Passed in by the host (Home
  // reads useNotifications().unreadCount) to keep this UI component decoupled
  // from the notifications store. Badge is hidden when 0 / omitted.
  unreadCount?: number;
  children?: ReactNode;
};

export default function HeaderDark({
  greeting,
  name,
  avatarUrl,
  onBellPress,
  onAvatarPress,
  unreadCount = 0,
  children,
}: Props) {
  const firstName = (name || '').trim().split(/\s+/)[0] || '';
  const initial = firstName.charAt(0).toUpperCase() || '?';

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.left}>
          <Text style={styles.greeting}>{greeting ?? defaultGreeting()}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {firstName}
          </Text>
        </View>
        <View style={styles.right}>
          <TouchableOpacity
            style={styles.bell}
            onPress={onBellPress}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="bell" size={20} color={colors.headerText} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onAvatarPress}
            activeOpacity={0.8}
            disabled={!onAvatarPress}
          >
            <Avatar
              url={avatarUrl}
              name={firstName || undefined}
              size={AVATAR}
              backgroundColor={colors.primary}
              textColor={colors.headerText}
            />
          </TouchableOpacity>
        </View>
      </View>
      {children}
    </View>
  );
}

const AVATAR = 44;

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 46,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flex: 1,
    marginRight: spacing.md,
  },
  greeting: {
    ...typography.body,
    color: colors.headerSubtext,
    marginBottom: 2,
  },
  name: {
    ...typography.greeting,
    color: colors.headerText,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  bell: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radii.pill,
    backgroundColor: colors.headerSurface,
    borderWidth: 1,
    borderColor: colors.headerSurfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radii.pill,
  },
  avatarFallback: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    ...typography.greeting,
    color: colors.headerText,
  },
});
