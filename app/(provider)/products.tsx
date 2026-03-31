import { StyleSheet, Text, View } from 'react-native';

export default function ProviderProductsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Products</Text>
      <Text style={styles.subtitle}>Manage your LPG stock and prices</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },
});
