import {
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { colors, radii, typography } from '../../lib/theme';

type Variant = 'primary' | 'outline' | 'danger' | 'onDark';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
};

export default function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: Props) {
  const isDisabled = disabled || loading;

  const containerStyle = [
    styles.base,
    variant === 'primary' && styles.primary,
    variant === 'outline' && styles.outline,
    variant === 'danger' && styles.danger,
    variant === 'onDark' && styles.onDark,
    isDisabled && styles.disabled,
  ];

  const textStyle = [
    styles.label,
    variant === 'primary' && styles.labelPrimary,
    variant === 'outline' && styles.labelOutline,
    variant === 'danger' && styles.labelDanger,
    variant === 'onDark' && styles.labelOnDark,
  ];

  const spinnerColor =
    variant === 'primary' ? colors.headerText
    : variant === 'onDark' ? colors.headerBg
    : colors.primary;

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'danger' ? colors.danger : spinnerColor} />
      ) : (
        <Text style={textStyle}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    height: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  primary: {
    backgroundColor: colors.primary,
  },
  outline: {
    backgroundColor: colors.card,
    borderColor: colors.primary,
  },
  danger: {
    backgroundColor: colors.card,
    borderColor: colors.danger,
  },
  // Inverted for dark backgrounds: white surface, dark-green label.
  onDark: {
    backgroundColor: colors.card,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    ...typography.button,
  },
  labelPrimary: {
    color: colors.headerText,
  },
  labelOutline: {
    color: colors.primary,
  },
  labelDanger: {
    color: colors.danger,
  },
  labelOnDark: {
    color: colors.headerBg,
  },
});
