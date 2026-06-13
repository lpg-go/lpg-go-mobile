import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ReactNode } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppLogo } from '../lib/useAppLogo';

type Props = {
  // 'bar'    = pinned white bar (bg + bottom border), owns the safe-area top inset.
  // 'inline' = no background/border (e.g. Home, sits inside a scroll view).
  variant?: 'bar' | 'inline';

  // Left cell — choose one:
  showLogo?: boolean;          // app logo (Home)
  logoHref?: string;           // when set, tapping the logo navigates here (e.g. Home)
  showBack?: boolean;          // chevron-left back button
  onBack?: () => void;         // back handler (defaults to router.back())

  // Center cell:
  title?: string;
  subtitle?: string;           // small line under the title (e.g. chat)

  // Right cell:
  right?: ReactNode;           // bell + avatar row, "Mark all read", or nothing

  // When true, drops the horizontal padding (0 instead of 20) — for placing the
  // header inside an already-padded container (e.g. Home's scroll content).
  noHorizontalPadding?: boolean;
};

// Shared customer header. Three-cell layout (left | centered title | right) so
// the title stays centered regardless of how wide the left/right content is.
export default function AppHeader({
  variant = 'bar',
  showLogo = false,
  logoHref,
  showBack = false,
  onBack,
  title,
  subtitle,
  right,
  noHorizontalPadding = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { logoUrl } = useAppLogo();

  // 'bar' owns the safe-area top inset; 'inline' assumes the screen handles it.
  const paddingTop = (variant === 'bar' ? insets.top : 0) + 14;

  const containerStyle = [
    styles.header,
    variant === 'bar' && styles.bar,
    { paddingTop, paddingHorizontal: noHorizontalPadding ? 0 : 20 },
  ];

  const backButton = (
    <TouchableOpacity
      onPress={onBack ?? (() => router.back())}
      hitSlop={8}
      style={styles.backBtn}
    >
      <Feather name="chevron-left" size={26} color="#111827" />
    </TouchableOpacity>
  );

  // Detail layout: [back] Title (left-aligned) .......... [right]
  if (showBack) {
    return (
      <View style={containerStyle}>
        {backButton}
        <View style={styles.titleLeftBlock}>
          {title ? <Text style={styles.titleLeft} numberOfLines={1}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitleLeft} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <View style={styles.rightCell}>{right}</View>
      </View>
    );
  }

  // Hub / centered layout: [logo or empty] | centered title | [right]
  return (
    <View style={containerStyle}>
      {/* Left cell */}
      <View style={styles.leftCell}>
        {showLogo ? (
          <TouchableOpacity
            onPress={() => router.push((logoHref ?? '/(customer)') as never)}
            activeOpacity={0.7}
          >
            {logoUrl ? (
              <Image source={{ uri: logoUrl }} style={styles.logoDynamic} resizeMode="contain" />
            ) : (
              <Image source={require('../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Center cell */}
      <View style={styles.centerCell}>
        {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      {/* Right cell */}
      <View style={styles.rightCell}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  bar: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },

  // Detail layout — back button + left-aligned title block.
  backBtn: { marginRight: 4 },
  titleLeftBlock: { flex: 1, justifyContent: 'center' },
  titleLeft: { fontSize: 18, fontWeight: '700', color: '#111827' },
  subtitleLeft: { fontSize: 12, color: '#6B7280', marginTop: 1 },

  // Left cell — min 40 reserves the back/logo footprint so the title centers.
  leftCell: {
    minWidth: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  logo: { width: 90, height: 36 },
  logoDynamic: { width: 140, height: 56 },

  // Center cell — flexes to fill, content centered.
  centerCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center' },
  subtitle: { fontSize: 12, color: '#6B7280', marginTop: 1, textAlign: 'center' },

  // Right cell — mirrors the left min-width so the title stays centered.
  rightCell: {
    minWidth: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
