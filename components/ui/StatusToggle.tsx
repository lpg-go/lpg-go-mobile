import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity } from 'react-native';

import { colors } from '../../lib/theme';

type FeatherName = keyof typeof Feather.glyphMap;

/**
 * Animated pill toggle shared by the provider online/offline status switch
 * (index.tsx) and the product "Selling" switch (products.tsx). Defaults match
 * the status-card look exactly; pass color overrides to fit a light surface.
 */
export default function StatusToggle({
  value,
  onToggle,
  disabled = false,
  onColor = colors.headerAccent,
  offColor = 'rgba(255,255,255,0.18)',
  offBorderColor = 'rgba(255,255,255,0.12)',
  icon = 'power',
  iconOnColor = colors.headerBg,
  iconOffColor = colors.textMuted,
}: {
  value: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  onColor?: string;
  offColor?: string;
  offBorderColor?: string;
  icon?: FeatherName | null;
  iconOnColor?: string;
  iconOffColor?: string;
}) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      useNativeDriver: false,
      friction: 7,
      tension: 70,
    }).start();
  }, [value, anim]);

  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [offColor, onColor],
    extrapolate: 'clamp',
  });
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [3, 21],
    extrapolate: 'clamp',
  });

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onToggle(!value)}
      disabled={disabled}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={disabled && styles.disabled}
    >
      <Animated.View
        style={[
          styles.track,
          { backgroundColor: trackColor, borderColor: offBorderColor },
          value && [styles.trackOn, { shadowColor: onColor }],
        ]}
      >
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]}>
          {icon && (
            <Feather name={icon} size={10} color={value ? iconOnColor : iconOffColor} />
          )}
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 40,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    borderWidth: 1,
  },
  trackOn: {
    borderColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 4,
  },
  thumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
  disabled: { opacity: 0.55 },
});
