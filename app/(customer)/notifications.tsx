import NotificationsScreen from '../../components/NotificationsScreen';

export default function CustomerNotifications() {
  return (
    <NotificationsScreen
      orderRoute="/(customer)/order/[id]"
      chatRoute="/(customer)/chat/[orderId]"
    />
  );
}
