import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radii, typography, shadows } from '../../lib/theme';

export type TabConfig = {
  key: string;
  label: string;
  icon: string;
  iconLib?: 'feather' | 'material';
  badgeCount?: number;
};

type Props = {
  tabs: TabConfig[];
  activeKey: string;
  onNavigate: (key: string) => void;
};

export default function FloatingPillNav({ tabs, activeKey, onNavigate }: Props) {
  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View style={styles.pill}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          const badgeCount = tab.badgeCount ?? 0;
          const showBadge = badgeCount > 0;
          const iconColor = isActive ? colors.headerText : colors.textMuted;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => onNavigate(tab.key)}
              activeOpacity={0.8}
            >
              <View style={styles.iconWrap}>
                {tab.iconLib === 'material' ? (
                  <MaterialCommunityIcons
                    name={tab.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                    size={20}
                    color={iconColor}
                  />
                ) : (
                  <Feather
                    name={tab.icon as keyof typeof Feather.glyphMap}
                    size={20}
                    color={iconColor}
                  />
                )}
                {showBadge && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </Text>
                  </View>
                )}
              </View>
              {isActive ? (
                <Text style={styles.labelActive}>{tab.label}</Text>
              ) : (
                <Text style={styles.label}>{tab.label}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xxl,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    ...shadows.nav,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  iconWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  tabActive: {
    backgroundColor: colors.headerBg,
  },
  label: {
    ...typography.label,
    fontSize: 13,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.textMuted,
  },
  labelActive: {
    ...typography.label,
    fontSize: 13,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.headerText,
  },
});
