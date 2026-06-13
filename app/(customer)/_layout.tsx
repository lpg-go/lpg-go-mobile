import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { NotificationsProvider } from '../../lib/notificationsStore';

const PRIMARY = '#16A34A';
const INACTIVE = '#9CA3AF';

export default function CustomerLayout() {
  return (
    <NotificationsProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: PRIMARY,
          tabBarInactiveTintColor: INACTIVE,
          tabBarStyle: { borderTopColor: '#E5E7EB' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="chat"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="profile"
          options={{ href: null }}
        />
        {/* Detail / utility screens — hidden from tab bar */}
        <Tabs.Screen
          name="brand/[id]"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="find-store/[productId]"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="order/[id]"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="chat/[orderId]"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="notifications"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
      </Tabs>
    </NotificationsProvider>
  );
}
