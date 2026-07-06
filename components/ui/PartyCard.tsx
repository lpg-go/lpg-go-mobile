import { Feather } from '@expo/vector-icons';
import { Image, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';

import { colors, radii, spacing, typography } from '../../lib/theme';
import Card from './Card';

type Props = {
  name: string;
  avatarUrl?: string | null;
  // Free-text second line (e.g. "LPG Provider"). Shown below the rating/meta row.
  subtitle?: string;
  // When provided, a star + value is shown on the meta row.
  rating?: number | null;
  // Optional "(N)" review count next to the rating.
  ratingCount?: number | null;
  // Optional extra on the meta row (e.g. "1.2 km away"), appended after rating.
  meta?: string;
  // Green online dot on the avatar's bottom-right.
  online?: boolean;
  // Action buttons render only when their handler is provided.
  onCall?: () => void;
  onChat?: () => void;
  // Makes the whole card tappable.
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

// Role-neutral "other party" card: avatar + name + optional rating/meta + optional
// call/chat buttons. Modeled on LiveMap's provider row; customer screens pass the
// provider, provider screens pass the customer. Uses the shared Card as surface.
export default function PartyCard({
  name,
  avatarUrl,
  subtitle,
  rating,
  ratingCount,
  meta,
  online,
  onCall,
  onChat,
  onPress,
  style,
}: Props) {
  const hasRating = rating != null;
  const hasMetaRow = hasRating || ratingCount != null || !!meta;

  return (
    <Card onPress={onPress} style={[styles.container, style]}>
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarInitials}>{initials(name)}</Text>
          )}
        </View>
        {online ? <View style={styles.onlineDot} /> : null}
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>

        {hasMetaRow ? (
          <View style={styles.metaRow}>
            {hasRating ? (
              <>
                <Feather name="star" size={12} color={colors.amber} />
                <Text style={styles.metaText}>{rating!.toFixed(1)}</Text>
              </>
            ) : null}
            {ratingCount != null ? (
              <Text style={styles.metaCount}>({ratingCount})</Text>
            ) : null}
            {meta ? (
              <Text style={styles.metaText}>
                {hasRating || ratingCount != null ? ' · ' : ''}{meta}
              </Text>
            ) : null}
          </View>
        ) : null}

        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      {(onCall || onChat) ? (
        <View style={styles.actionRow}>
          {onCall ? (
            <TouchableOpacity style={styles.callBtn} onPress={onCall} activeOpacity={0.8}>
              <Feather name="phone" size={18} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
          {onChat ? (
            <TouchableOpacity style={styles.chatBtn} onPress={onChat} activeOpacity={0.8}>
              <Feather name="message-circle" size={18} color="#fff" />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const AVATAR = 46;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radii.pill,
    backgroundColor: colors.headerBg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: AVATAR, height: AVATAR, borderRadius: radii.pill },
  avatarInitials: { fontSize: 16, fontWeight: '700', color: colors.headerAccent },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 13,
    height: 13,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.card,
  },

  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  metaText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  metaCount: { fontSize: 13, color: colors.textMuted },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  actionRow: { flexDirection: 'row', gap: spacing.sm },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
