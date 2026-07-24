import '../global.css';

import { Session } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';
import { router, Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { registerForPushNotificationsAsync } from '../lib/notifications';
import { fetchProviderDocRequired } from '../lib/settings';
import supabase from '../lib/supabase';

// Keep the native splash up until the first auth-based route decision is made,
// so already-signed-in users go splash -> home with no flash of the login form.
SplashScreen.preventAutoHideAsync().catch(() => {});

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
      SplashScreen.hideAsync().catch(() => {});
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
      await SplashScreen.hideAsync().catch(() => {});
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

  // This layout is the auth gate holding the session. Redirecting to login while
  // the session survives just re-runs redirectByRole and loops on the same branch,
  // so recovery has to clear the session: signOut fires onAuthStateChange, and the
  // !session path routes to login exactly once. Same reasoning as the admin branch.
  function signOutWithMessage(title: string, body: string) {
    Alert.alert(
      title,
      body,
      [{ text: 'OK', onPress: async () => { await supabase.auth.signOut(); } }],
      { cancelable: false }
    );
  }

  async function redirectByRole(userId: string) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_approved, document_url, provider_type')
      .eq('id', userId)
      .single();

    if (!profile) {
      signOutWithMessage(
        "Couldn't load your profile",
        "We couldn't load your profile. You'll be signed out so you can sign in again."
      );
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
      // Admins have no screens here, and this layout is the auth gate: routing
      // them anywhere while the session survives just re-runs this branch, so a
      // redirect alone would loop. Signing out clears the session and fires
      // onAuthStateChange, which sends them to login through the !session path.
      Alert.alert(
        'Admin account',
        'Admin accounts are managed from the web dashboard and cannot be used in the mobile app. You will be signed out.',
        [{ text: 'OK', onPress: async () => { await supabase.auth.signOut(); } }],
        { cancelable: false }
      );
    } else {
      signOutWithMessage(
        "Couldn't load your account",
        "We couldn't load your account. You'll be signed out so you can sign in again."
      );
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
