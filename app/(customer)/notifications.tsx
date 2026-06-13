import CustomerHeaderActions from '../../components/CustomerHeaderActions';
import NotificationsScreen from '../../components/NotificationsScreen';

export default function CustomerNotifications() {
  return (
    <NotificationsScreen
      orderRoute="/(customer)/order/[id]"
      chatRoute="/(customer)/chat/[orderId]"
      homeHref="/(customer)"
      headerRight={<CustomerHeaderActions />}
    />
  );
}
