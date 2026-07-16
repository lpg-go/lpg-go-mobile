import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

import supabase from './supabase';

export type Notification = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  order_id: string | null;
  is_read: boolean;
  created_at: string;
};

// Notification types that surface a transient in-app banner. Excludes
// new_message — the chat screens render their own message banner.
const BANNER_TYPES = new Set([
  'new_order',
  'dealer_accepted',
  'multiple_dealers_accepted',
  'dealer_selected',
  'order_cancelled',
  'in_transit',
  'awaiting_confirmation',
  'delivery_confirmed',
  'low_balance',
  'provider_unavailable',
  'new_message',
]);

const BANNER_DURATION_MS = 4000;

type NotificationsContextValue = {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  bannerNotification: Notification | null;
  dismissBanner: () => void;
  // Global chat sheet — openChat(orderId, name?) makes the app-level
  // <GlobalChatModal> slide up the chat for that order; clearChat() closes it.
  // The optional name seeds the header immediately (no "Chat" placeholder flash).
  pendingChatOrderId: string | null;
  pendingChatName: string | null;
  openChat: (orderId: string, name?: string) => void;
  clearChat: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refresh: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerNotification, setBannerNotification] = useState<Notification | null>(null);
  const userIdRef = useRef<string | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissBanner = useCallback(() => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
    setBannerNotification(null);
  }, []);

  const [pendingChatOrderId, setPendingChatOrderId] = useState<string | null>(null);
  const [pendingChatName, setPendingChatName] = useState<string | null>(null);
  const openChat = useCallback((orderId: string, name?: string) => {
    setPendingChatName(name ?? null);
    setPendingChatOrderId(orderId);
  }, []);
  const clearChat = useCallback(() => {
    setPendingChatOrderId(null);
    setPendingChatName(null);
  }, []);

  const fetchNotifications = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from('notifications')
      .select('id, user_id, title, body, type, order_id, is_read, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    setNotifications((data ?? []) as Notification[]);
  }, []);

  const refresh = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    await fetchNotifications(uid);
  }, [fetchNotifications]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setLoading(false);
        return;
      }

      userIdRef.current = user.id;
      await fetchNotifications(user.id);
      // Re-check: the fetch above is a second await, so an unmount during it
      // would otherwise let us subscribe a channel cleanup has already missed.
      if (cancelled) return;
      setLoading(false);

      channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const next = payload.new as Notification;
            setNotifications((prev) =>
              prev.some((n) => n.id === next.id) ? prev : [next, ...prev]
            );

            // Surface a transient in-app banner for actionable types.
            if (BANNER_TYPES.has(next.type)) {
              if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
              setBannerNotification(next);
              bannerTimerRef.current = setTimeout(
                () => setBannerNotification(null),
                BANNER_DURATION_MS
              );
            }
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [fetchNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  }, []);

  const markAllAsRead = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', uid)
      .eq('is_read', false);
  }, []);

  const unreadCount = notifications.reduce((n, x) => n + (x.is_read ? 0 : 1), 0);

  return (
    <NotificationsContext.Provider
      value={{ notifications, unreadCount, loading, bannerNotification, dismissBanner, pendingChatOrderId, pendingChatName, openChat, clearChat, markAsRead, markAllAsRead, refresh }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
