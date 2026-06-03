import NotificationsScreen from '../../components/NotificationsScreen';

export default function ProviderNotifications() {
  return (
    <NotificationsScreen
      orderRoute="/(provider)/active/[id]"
      chatRoute="/(provider)/chat/[orderId]"
    />
  );
}
