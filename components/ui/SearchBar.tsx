import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radii, typography, shadows } from '../../lib/theme';

type Props = {
  placeholder?: string;
  onPress?: () => void;
  value?: string;
  onChangeText?: (text: string) => void;
};

export default function SearchBar({
  placeholder = 'Search',
  onPress,
  value,
  onChangeText,
}: Props) {
  const isLive = typeof onChangeText === 'function';

  const inner = (
    <>
      <Feather name="search" size={18} color={colors.textMuted} />
      {isLive ? (
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChangeText}
        />
      ) : (
        <Text style={styles.placeholder} numberOfLines={1}>
          {value && value.length > 0 ? value : placeholder}
        </Text>
      )}
    </>
  );

  if (isLive) {
    return <View style={styles.container}>{inner}</View>;
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.8}
      disabled={!onPress}
    >
      {inner}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    height: 48,
    ...shadows.card,
  },
  input: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    padding: 0,
  },
  placeholder: {
    ...typography.body,
    color: colors.textMuted,
    flex: 1,
  },
});
