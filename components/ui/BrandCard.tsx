import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radii, brandTints } from '../../lib/theme';
import BrandProductImage from './BrandProductImage';

type Props = {
  name: string;
  imageUrl?: string | null;
  index: number;
  isFeatured?: boolean;
  onPress: () => void;
};

export default function BrandCard({
  name,
  imageUrl,
  index,
  isFeatured,
  onPress,
}: Props) {
  const tint = brandTints[index % brandTints.length];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.imageZone, { backgroundColor: tint.bg }]}>
        <BrandProductImage
          url={imageUrl}
          style={styles.image}
          resizeMode="cover"
          iconSize={30}
          iconColor={tint.icon}
        />
      </View>
      {isFeatured ? (
        <View style={styles.featuredPill}>
          <Text style={styles.featuredText}>Featured</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  imageZone: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  featuredPill: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredText: {
    color: colors.headerText,
    fontSize: 9,
    fontWeight: '700',
  },
});
