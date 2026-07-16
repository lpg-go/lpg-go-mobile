import { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { getInitials } from '../../lib/format';
import { colors } from '../../lib/theme';

type Props = {
  url?: string | null;
  name?: string;
  size?: number;
  backgroundColor?: string;
  textColor?: string;
  style?: StyleProp<ViewStyle>;
};

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
