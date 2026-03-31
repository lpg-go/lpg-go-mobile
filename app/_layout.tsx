import '../global.css';

import { Session } from '@supabase/supabase-js';
import { router, Slot } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import supabase from '../lib/supabase';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading) return;

    if (!session) {
      router.replace('/(auth)/login');
      return;
    }

    redirectByRole(session.user.id);
  }, [session, loading]);

  async function redirectByRole(userId: string) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (!profile) {
      router.replace('/(auth)/complete-profile');
      return;
    }

    if (profile.role === 'customer') router.replace('/(customer)');
    else if (profile.role === 'provider') router.replace('/(provider)');
    else if (profile.role === 'admin') router.replace('/(admin)');
    else router.replace('/(auth)/complete-profile');
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    );
  }

  return <Slot />;
}
