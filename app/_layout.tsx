import '../global.css';

import { Session } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';
import { router, Slot } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { registerForPushNotificationsAsync } from '../lib/notifications';
import { fetchProviderDocRequired } from '../lib/settings';
import supabase from '../lib/supabase';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Role of the signed-in user, kept in a ref so the notification-tap handler
  // (set up once per session) always reads the current value without re-subscribing.
  const roleRef = useRef<string | null>(null);

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

    // Register the Expo push token on session restore too, not just login —
    // a user who keeps an existing session would otherwise never get a token.
    // Fire-and-forget; idempotent upsert, and it no-ops safely in Expo Go.
    registerForPushNotificationsAsync();

    // Redirect to the role home, then handle a cold-start notification tap
    // (app opened from a killed state). roleRef is populated by redirectByRole,
    // so we await it before routing the deep link on top of the home screen.
    (async () => {
      await redirectByRole(session.user.id);
      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      if (lastResponse) handleNotificationResponse(lastResponse);
    })();

    // Foreground/background taps: navigate based on the push data payload.
    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    return () => subscription.remove();
  }, [session, loading]);

  // Route a notification tap by its data payload. `type` (set on the push)
  // targets role-specific screens; otherwise fall back to orderId + role.
  function handleNotificationResponse(response: Notifications.NotificationResponse) {
    const data = response.notification.request.content.data as {
      type?: string;
      orderId?: string;
      providerId?: string;
    };

    if (data.type === 'new_order') {
      router.push('/(provider)');
      return;
    }
    if (data.type === 'low_balance') {
      router.push('/(provider)/earnings');
      return;
    }
    if (data.orderId) {
      if (roleRef.current === 'customer') {
        router.push({ pathname: '/(customer)/order/[id]', params: { id: data.orderId } });
      } else if (roleRef.current === 'provider') {
        router.push({ pathname: '/(provider)/active/[id]', params: { id: data.orderId } });
      }
    }
  }

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

    roleRef.current = profile.role;

    if (profile.role === 'customer') {
      router.replace('/(customer)');
    } else if (profile.role === 'provider') {
      // Approval is the real gate for operating (orders, visibility, RLS).
      // When a document isn't required, the auto-approve trigger has already set
      // is_approved=true, so an approved provider goes straight in. An unapproved
      // provider is sent to upload-document only when documents are required;
      // otherwise they wait there for admin approval as before.
      if (profile.is_approved) {
        router.replace('/(provider)');
      } else if (await fetchProviderDocRequired()) {
        router.replace('/(auth)/upload-document');
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
