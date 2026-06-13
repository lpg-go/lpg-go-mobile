import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
};

// Shared header for bottom-sheet popups (chat, map): title + subtitle on the
// left, an X close button on the right.
export default function SheetHeader({ title, subtitle, onClose }: Props) {
  return (
    <View style={styles.header}>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <TouchableOpacity onPress={onClose} hitSlop={8}>
        <Feather name="x" size={22} color="#6B7280" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  text: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
});
