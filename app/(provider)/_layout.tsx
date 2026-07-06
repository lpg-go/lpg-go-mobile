import { Tabs } from 'expo-router';

import GlobalChatModal from '../../components/GlobalChatModal';
import NotificationBanner from '../../components/NotificationBanner';
import { NotificationsProvider } from '../../lib/notificationsStore';

export default function ProviderLayout() {
  return (
    <NotificationsProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          // Credit + Products live in the header (ProviderHeaderActions) now, so
          // there are no visible bottom tabs — hide the tab bar entirely.
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="earnings"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="products"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="profile"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="topup"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="reviews"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="active/[id]"
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
        <Tabs.Screen
          name="recent-orders"
          options={{ href: null, tabBarStyle: { display: 'none' } }}
        />
      </Tabs>
      <GlobalChatModal role="provider" />
      <NotificationBanner />
    </NotificationsProvider>
  );
}
