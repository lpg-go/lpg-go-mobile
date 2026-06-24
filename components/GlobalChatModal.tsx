import { useEffect, useState } from 'react';

import { type ChatRole } from '../lib/chatReplies';
import { useNotifications } from '../lib/notificationsStore';
import supabase from '../lib/supabase';
import ChatModal from './ChatModal';

type Props = {
  // Which app shell mounted this sheet — drives the quick-reply set. Each
  // (customer)/(provider) layout passes its own role.
  role: ChatRole;
};

// App-level chat sheet. Driven by the notificationsStore's pendingChatOrderId
// (set via openChat). Resolves currentUserId + the other party's name from the
// order, then slides up the same <ChatModal> sheet used on the order screens.
export default function GlobalChatModal({ role }: Props) {
  const { pendingChatOrderId, pendingChatName, clearChat } = useNotifications();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUserName, setOtherUserName] = useState('Chat');

  // Resolve the signed-in user ONCE at mount so the sheet can open instantly
  // (visible isn't gated on a per-open fetch).
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (alive && user) setCurrentUserId(user.id);
    });
    return () => { alive = false; };
  }, []);

  // Seed the header name immediately from the notification (no "Chat" flash).
  // Only fall back to an order/profile lookup when no name was passed.
  useEffect(() => {
    if (!pendingChatOrderId) return;
    setOtherUserName(pendingChatName ?? 'Chat');
    if (pendingChatName) return;

    let alive = true;
    (async () => {
      const uid = currentUserId ?? (await supabase.auth.getUser()).data.user?.id;
      if (!alive || !uid) return;

      const { data: order } = await supabase
        .from('orders')
        .select('customer_id, selected_provider_id')
        .eq('id', pendingChatOrderId)
        .single();
      if (!alive || !order) return;

      const otherId = uid === order.customer_id ? order.selected_provider_id : order.customer_id;
      if (!otherId) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', otherId)
        .single();
      if (alive && profile?.full_name) setOtherUserName(profile.full_name);
    })();

    return () => { alive = false; };
  }, [pendingChatOrderId, pendingChatName, currentUserId]);

  return (
    <ChatModal
      visible={!!pendingChatOrderId && !!currentUserId}
      onClose={clearChat}
      orderId={pendingChatOrderId ?? ''}
      currentUserId={currentUserId ?? ''}
      otherUserName={otherUserName}
      role={role}
    />
  );
}
