import NotificationsScreen from '../../components/NotificationsScreen';
import ProviderHeaderActions from '../../components/ProviderHeaderActions';

export default function ProviderNotifications() {
  return (
    <NotificationsScreen
      homeHref="/(provider)"
      headerRight={<ProviderHeaderActions />}
    />
  );
}
