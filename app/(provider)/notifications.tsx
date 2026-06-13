import NotificationsScreen from '../../components/NotificationsScreen';
import ProviderHeaderActions from '../../components/ProviderHeaderActions';

export default function ProviderNotifications() {
  return (
    <NotificationsScreen
      orderRoute="/(provider)/active/[id]"
      chatRoute="/(provider)/chat/[orderId]"
      homeHref="/(provider)"
      headerRight={<ProviderHeaderActions />}
    />
  );
}
