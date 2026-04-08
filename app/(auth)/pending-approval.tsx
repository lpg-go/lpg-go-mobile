import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import supabase from '../../lib/supabase';

const GREEN = '#16A34A';
const POLL_INTERVAL_MS = 30_000;

export default function PendingApprovalScreen() {
  const [signingOut, setSigningOut] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Poll immediately on mount, then every 30s
    checkApproval();
    intervalRef.current = setInterval(checkApproval, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function checkApproval() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_approved')
      .eq('id', user.id)
      .single();

    if (profile?.is_approved) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      router.replace('/(provider)');
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    // _layout will redirect to login on session change
  }

  return (
    <View style={styles.container}>
      {/* Logo */}
      <View style={styles.logoBox}>
        <Text style={styles.logoText}>L</Text>
      </View>
      <Text style={styles.appName}>LPG Go</Text>

      {/* Hourglass */}
      <Text style={styles.icon}>⏳</Text>

      <Text style={styles.title}>Account Pending Approval</Text>
      <Text style={styles.message}>
        Your account is under review. You will be notified once approved.
      </Text>

      <View style={styles.pollingRow}>
        <ActivityIndicator size="small" color="#9CA3AF" />
        <Text style={styles.pollingText}>Checking status every 30 seconds…</Text>
      </View>

      <TouchableOpacity
        style={[styles.signOutButton, signingOut && styles.signOutButtonDisabled]}
        onPress={handleSignOut}
        disabled={signingOut}
        activeOpacity={0.7}
      >
        {signingOut ? (
          <ActivityIndicator color="#6B7280" />
        ) : (
          <Text style={styles.signOutText}>Sign Out</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  logoText: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
  },
  appName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 32,
  },
  icon: {
    fontSize: 52,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  pollingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 48,
  },
  pollingText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  signOutButton: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    alignItems: 'center',
  },
  signOutButtonDisabled: {
    opacity: 0.5,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#6B7280',
  },
});
