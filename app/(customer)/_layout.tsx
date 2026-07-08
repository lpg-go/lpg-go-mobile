import { Tabs } from 'expo-router';

import GlobalChatModal from '../../components/GlobalChatModal';
import NotificationBanner from '../../components/NotificationBanner';
import { NotificationsProvider } from '../../lib/notificationsStore';

// Navigation is header-driven (logo / orders / bell / avatar), so the bottom
// tab bar is hidden entirely.
export default function CustomerLayout() {
  return (
    <NotificationsProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="orders" options={{ href: null }} />
        <Tabs.Screen name="history" options={{ href: null }} />
        <Tabs.Screen name="chat" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ href: null }} />
        {/* Detail / utility screens */}
        <Tabs.Screen name="brand/[id]" options={{ href: null }} />
        <Tabs.Screen name="find-store/[productId]" options={{ href: null }} />
        <Tabs.Screen name="order/[id]" options={{ href: null }} />
        <Tabs.Screen name="chat/[orderId]" options={{ href: null }} />
        <Tabs.Screen name="notifications" options={{ href: null }} />
      </Tabs>
      <GlobalChatModal role="customer" />
      <NotificationBanner />
    </NotificationsProvider>
  );
}
