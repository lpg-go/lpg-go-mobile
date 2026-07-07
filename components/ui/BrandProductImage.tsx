import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { colors } from '../../lib/theme';

type Props = {
  url?: string | null;
  size?: number;
  iconSize?: number;
  iconColor?: string;
  // Applied to the fallback zone only — never to the image, so an image with a
  // transparent PNG doesn't pick up a tint the original didn't have.
  backgroundColor?: string;
  resizeMode?: 'cover' | 'contain';
  borderRadius?: number;
  style?: StyleProp<ViewStyle | ImageStyle>;
};

// Shared brand/product image. Renders the remote image when a url is present,
// and falls back to a gas-cylinder icon both when there's no url AND when the
// image fails to load (onError) — the latter is why set-but-broken images
// previously rendered blank. Mirrors the Avatar component.
export default function BrandProductImage({
  url,
  size = 48,
  iconSize,
  iconColor = colors.textMuted,
  backgroundColor = 'transparent',
  resizeMode = 'cover',
  borderRadius = 0,
  style,
}: Props) {
  const [failed, setFailed] = useState(false);

  // A new url is a fresh chance to load — clear any prior failure.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  const dimension = { width: size, height: size, borderRadius };

  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        onError={() => setFailed(true)}
        resizeMode={resizeMode}
        style={[dimension, style] as StyleProp<ImageStyle>}
      />
    );
  }

  return (
    <View style={[dimension, styles.fallback, { backgroundColor }, style] as StyleProp<ViewStyle>}>
      <MaterialCommunityIcons
        name="gas-cylinder"
        size={iconSize ?? Math.round(size * 0.6)}
        color={iconColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
