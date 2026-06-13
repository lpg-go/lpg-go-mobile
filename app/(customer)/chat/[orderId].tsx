import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ChatScreen from '../../../components/ChatScreen';
import supabase from '../../../lib/supabase';

export default function CustomerChatScreen() {
  const insets = useSafeAreaInsets();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [providerName, setProviderName] = useState('Provider');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.back(); return; }
      setCurrentUserId(user.id);

      const { data: order } = await supabase
        .from('orders')
        .select('selected_provider_id')
        .eq('id', orderId)
        .single();

      if (order?.selected_provider_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', order.selected_provider_id)
          .single();
        if (profile) setProviderName(profile.full_name);
      }

      setReady(true);
    }
    init();
  }, [orderId]);

  if (!ready || !currentUserId) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#16A34A" />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ChatScreen
        orderId={orderId}
        currentUserId={currentUserId}
        otherUserName={providerName}
        onClose={() => router.back()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1, backgroundColor: '#fff' },
});
