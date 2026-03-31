import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import supabase from '../../lib/supabase';

export default function CustomerProfileScreen() {
  async function handleSignOut() {
    await supabase.auth.signOut();
    // Root layout redirects to /(auth)/login on session clear
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>My Profile</Text>
      </View>
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },
});
