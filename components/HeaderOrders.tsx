import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useActiveOrderCount } from '../lib/useActiveOrderCount';

type Props = {
  href: '/(customer)/orders';
  color?: string;
  // When true, the button shows a green ring (it's the current screen).
  active?: boolean;
};

// Orders icon for the customer header — package glyph with a live active-order
// count badge. Replaces the former Orders tab.
export default function HeaderOrders({ href, color = '#374151', active = false }: Props) {
  const activeCount = useActiveOrderCount();

  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={() => router.push(href)}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <MaterialCommunityIcons name="cube-outline" size={24} color={active ? '#16A34A' : color} />
      {activeCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{activeCount > 99 ? '99+' : activeCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
});
