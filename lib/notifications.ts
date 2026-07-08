import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import supabase from './supabase';

const NOTIFICATIONS_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/order-notifications';

export async function sendOrderNotification(orderId: string, event: string): Promise<void> {
  try {
    // Authenticate with the caller's own session JWT. The edge function verifies
    // it and confirms the user participates in the order, so we no longer ship a
    // static shared secret in the bundle.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch(NOTIFICATIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ orderId, event }),
    });
    if (!res.ok) {
      console.warn('[sendOrderNotification] non-OK status', res.status);
    }
  } catch (err) {
    console.error('[sendOrderNotification] fetch error', err);
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotificationsAsync(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#16A34A',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return;

  // Remote push tokens are unsupported in Expo Go on SDK 53+, skip the fetch there.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    console.warn('[registerForPushNotificationsAsync] skipping push token fetch in Expo Go');
    return;
  }

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({
      projectId: '561fa033-aa41-477a-9e42-88d23c44049b',
    });
    token = result.data;
  } catch (err) {
    console.warn('[registerForPushNotificationsAsync] failed to get Expo push token', err);
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('profiles')
    .update({ expo_push_token: token })
    .eq('id', user.id);
}
