import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';

import supabase from '../lib/supabase';

const PRIMARY = '#16A34A';

type Props = {
  href: '/(customer)/profile' | '/(provider)/profile';
};

// Circular profile avatar for the customer/provider headers. Fetches the
// signed-in user's avatar_url itself, and routes to the Profile screen on tap.
export default function HeaderAvatar({ href }: Props) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', user.id)
        .single();
      // avatar_url already carries a ?t= cache-buster baked in at upload time
      // (see profile.tsx), so we use it as-is.
      if (active && data?.avatar_url) setAvatarUrl(data.avatar_url);
    })();
    return () => { active = false; };
  }, []);

  return (
    <TouchableOpacity
      onPress={() => router.push(href)}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {avatarUrl ? (
        <Image key={avatarUrl} source={{ uri: avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.fallback]}>
          <Feather name="user" size={18} color={PRIMARY} />
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  fallback: {
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
