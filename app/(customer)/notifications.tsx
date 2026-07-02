import CustomerHeaderActions from '../../components/CustomerHeaderActions';
import NotificationsScreen from '../../components/NotificationsScreen';

export default function CustomerNotifications() {
  return (
    <NotificationsScreen
      homeHref="/(customer)"
      headerRight={<CustomerHeaderActions />}
    />
  );
}
