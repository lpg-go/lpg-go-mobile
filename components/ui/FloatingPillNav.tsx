import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radii, typography, shadows } from '../../lib/theme';

type Tab = 'home' | 'orders';

type Props = {
  active: Tab;
  onNavigate: (tab: Tab) => void;
};

const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'orders', label: 'Orders', icon: 'package' },
];

export default function FloatingPillNav({ active, onNavigate }: Props) {
  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View style={styles.pill}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => onNavigate(tab.key)}
              activeOpacity={0.8}
            >
              <Feather
                name={tab.icon}
                size={20}
                color={isActive ? colors.headerText : colors.textMuted}
              />
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
  tabActive: {
    backgroundColor: colors.headerBg,
  },
  label: {
    ...typography.label,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.textMuted,
  },
  labelActive: {
    ...typography.label,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.headerText,
  },
});
