import { Feather } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { colors, radii, shadows, spacing } from '../../lib/theme';

export type DropdownOption = { label: string; value: string };

type Props = {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

// A modern dropdown: a rounded pill trigger that opens an anchored menu card
// (positioned just under the trigger via measureInWindow). Selected row is
// tinted with a check.
export default function Dropdown({ options, value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const triggerRef = useRef<View>(null);
  const { width: screenW } = useWindowDimensions();

  const selected = options.find((o) => o.value === value);

  const openMenu = () => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  };

  return (
    <>
      <TouchableOpacity
        ref={triggerRef}
        style={styles.trigger}
        onPress={openMenu}
        activeOpacity={0.7}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {selected?.label ?? placeholder ?? 'Select'}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.primary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View
            style={[
              styles.menu,
              {
                top: anchor.y + anchor.height + 6,
                right: Math.max(spacing.lg, screenW - (anchor.x + anchor.width)),
              },
            ]}
          >
            <ScrollView bounces={false} style={styles.menuScroll}>
              {options.map((opt) => {
                const active = opt.value === value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={styles.item}
                    onPress={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[styles.itemText, active && styles.itemTextActive]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                    {active ? <Feather name="check" size={16} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  triggerText: { fontSize: 14, fontWeight: '600', color: colors.primary, maxWidth: 150 },

  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    minWidth: 190,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 4,
    ...shadows.raised,
  },
  menuScroll: { maxHeight: 300 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
  },
  itemText: { fontSize: 14, color: colors.text, flex: 1 },
  itemTextActive: { color: colors.primary, fontWeight: '600' },
});
