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
      .select('role, is_approved, document_url, provider_type')
      .eq('id', userId)
      .single();

    if (!profile) {
      router.replace('/(auth)/complete-profile');
      return;
    }

    if (profile.role === 'customer') {
      router.replace('/(customer)');
    } else if (profile.role === 'provider') {
      if (!profile.document_url) {
        router.replace('/(auth)/upload-document');
      } else if (!profile.is_approved) {
        router.replace('/(auth)/pending-approval');
      } else {
        router.replace('/(provider)');
      }
    } else if (profile.role === 'admin') {
      router.replace('/(admin)');
    } else {
      router.replace('/(auth)/complete-profile');
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#16A34A" />
      </View>
    );
  }

  return <Slot />;
}
