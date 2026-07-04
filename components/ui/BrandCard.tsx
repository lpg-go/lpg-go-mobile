import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radii, typography, brandTints } from '../../lib/theme';

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
      style={[styles.card, isFeatured && styles.cardFeatured]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.imageZone, { backgroundColor: tint.bg }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <MaterialCommunityIcons name="gas-cylinder" size={30} color={tint.icon} />
        )}
      </View>
      {isFeatured ? (
        <View style={styles.featuredPill}>
          <Text style={styles.featuredStar}>★</Text>
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
      </View>
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
  cardFeatured: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  imageZone: {
    height: 58,
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
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredStar: {
    color: colors.headerText,
    fontSize: 11,
    lineHeight: 13,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  name: {
    ...typography.cardTitle,
    fontSize: 12,
    color: colors.text,
    textAlign: 'left',
  },
});
