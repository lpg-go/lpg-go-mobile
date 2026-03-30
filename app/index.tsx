import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import supabase from '../lib/supabase';

export default function Index() {
  const [status, setStatus] = useState('Connecting...');

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('*')
      .then(({ error }) => {
        if (error) {
          setStatus(error.message);
        } else {
          setStatus('Supabase connected');
        }
      });
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>{status}</Text>
    </View>
  );
}
