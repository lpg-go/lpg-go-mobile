import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import supabase from './supabase';

const NOTIFICATIONS_URL = 'https://rgqwaiassatyruptsgbs.supabase.co/functions/v1/order-notifications';
const APP_SECRET = process.env.EXPO_PUBLIC_APP_SECRET!;

export async function sendOrderNotification(orderId: string, event: string): Promise<void> {
  console.log('[sendOrderNotification] calling', event, orderId);
  try {
    const res = await fetch(NOTIFICATIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-secret': APP_SECRET,
      },
      body: JSON.stringify({ orderId, event }),
    });
    const text = await res.text();
    console.log('[sendOrderNotification] full response:', text);
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

  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId: '561fa033-aa41-477a-9e42-88d23c44049b',
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('profiles')
    .update({ expo_push_token: token })
    .eq('id', user.id);
}
