import { Feather } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing } from '../../lib/theme';

type Props = {
  name: string;
  avatarUrl?: string | null;
  // When provided, an online dot is shown on the avatar (green when true, grey
  // when false). Omit entirely to hide the dot (e.g. the customer header).
  online?: boolean;
  // Right-side slot, e.g. a notification bell.
  right?: ReactNode;
  // Content below the identity row — address bar (customer) or stat cards (provider).
  children?: ReactNode;
  onAvatarPress?: () => void;
};

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getInitials(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?'
  );
}

// The dark-green home header shared by provider + customer home screens: an
// identity row (avatar + name + subtitle) with an optional right slot and a
// children slot below (address bar / stat cards). Rounded bottom corners.
export default function IdentityHeader({
  name,
  avatarUrl,
  online,
  right,
  children,
  onAvatarPress,
}: Props) {
  const insets = useSafeAreaInsets();

  const avatar = (
    <View style={styles.avatarWrap}>
      <View style={styles.profileIcon}>
        <Feather name="user" size={22} color={colors.headerAccent} />
      </View>
      {online !== undefined && (
        <View
          style={[
            styles.onlineDot,
            { backgroundColor: online ? colors.headerAccent : colors.textMuted },
          ]}
        />
      )}
    </View>
  );

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.identityRow}>
        <View style={styles.identityText}>
          <Text style={styles.greeting} numberOfLines={1}>
            {timeGreeting()}
          </Text>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </View>

        {right ? <View style={styles.rightSlot}>{right}</View> : null}

        {onAvatarPress ? (
          <TouchableOpacity onPress={onAvatarPress} activeOpacity={0.7}>
            {avatar}
          </TouchableOpacity>
        ) : (
          avatar
        )}
      </View>

      {children ? <View style={styles.children}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.screenH,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarWrap: { position: 'relative' },
  profileIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.headerSurface,
    borderWidth: 1,
    borderColor: colors.headerSurfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { color: colors.headerText, fontSize: 16, fontWeight: '700' },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.headerBg,
  },
  identityText: { flex: 1 },
  greeting: { color: colors.headerSubtext, fontSize: 13, fontWeight: '500', marginBottom: 2 },
  name: { color: colors.headerText, fontSize: 16, fontWeight: '600' },
  rightSlot: { flexShrink: 0 },
  children: { marginTop: spacing.md },
});
