import { ReactNode } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radii, typography } from '../../lib/theme';

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
  children?: ReactNode;
};

export default function HeaderDark({
  greeting,
  name,
  avatarUrl,
  onBellPress,
  onAvatarPress,
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
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onAvatarPress}
            activeOpacity={0.8}
            disabled={!onAvatarPress}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
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
