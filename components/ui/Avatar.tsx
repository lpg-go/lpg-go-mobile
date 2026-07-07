import { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors } from '../../lib/theme';

type Props = {
  url?: string | null;
  name?: string;
  size?: number;
  backgroundColor?: string;
  textColor?: string;
  style?: StyleProp<ViewStyle>;
};

// Initials from the first + last word of the name, uppercased, max 2 chars.
// Falls back to "?" when there's no usable name.
function getInitials(name?: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

// Shared circular avatar. Renders the remote image when a url is present, and
// falls back to initials both when there's no url AND when the image fails to
// load (onError) — the latter is why some avatars previously rendered blank.
export default function Avatar({
  url,
  name,
  size = 40,
  backgroundColor = colors.headerBg,
  textColor = colors.headerAccent,
  style,
}: Props) {
  const [failed, setFailed] = useState(false);

  // A new url is a fresh chance to load — clear any prior failure.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  const dimension = { width: size, height: size, borderRadius: size / 2 };

  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        onError={() => setFailed(true)}
        style={[dimension, style] as StyleProp<ImageStyle>}
      />
    );
  }

  return (
    <View style={[dimension, styles.fallback, { backgroundColor }, style]}>
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.38), color: textColor }]}>
        {getInitials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { fontWeight: '700' },
});
