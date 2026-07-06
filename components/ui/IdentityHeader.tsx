import { ReactNode } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing } from '../../lib/theme';

type Props = {
  name: string;
  // Customer: display_id (e.g. "LGCS00001"). Provider: "LGRD00001 · Rider".
  subtitle?: string;
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
  subtitle,
  avatarUrl,
  online,
  right,
  children,
  onAvatarPress,
}: Props) {
  const insets = useSafeAreaInsets();

  const avatar = (
    <View style={styles.avatarWrap}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitials}>{getInitials(name)}</Text>
        </View>
      )}
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
        {onAvatarPress ? (
          <TouchableOpacity onPress={onAvatarPress} activeOpacity={0.7}>
            {avatar}
          </TouchableOpacity>
        ) : (
          avatar
        )}

        <View style={styles.identityText}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {right ? <View style={styles.rightSlot}>{right}</View> : null}
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
  name: { color: colors.headerText, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.headerSubtext, fontSize: 12, fontWeight: '500', marginTop: 1 },
  rightSlot: { flexShrink: 0 },
  children: { marginTop: spacing.md },
});
