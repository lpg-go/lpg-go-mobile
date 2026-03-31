import { StyleSheet, Text, View } from 'react-native';

export default function CustomerHomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to LPG Go</Text>
      <Text style={styles.subtitle}>Browse LPG brands and order delivery</Text>
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
    color: '#16A34A',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },
});
