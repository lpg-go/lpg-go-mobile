import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import supabase from '../lib/supabase';
import Avatar from './ui/Avatar';

const PRIMARY = '#16A34A';

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

type Props = {
  href: '/(customer)/profile' | '/(provider)/profile';
  // When provided, a status dot is shown (green = online, grey = offline).
  // Omit it (customers) to render no dot.
  online?: boolean | null;
  // Highlights the avatar with a green ring when it's the current screen.
  active?: boolean;
};

// Circular profile avatar for the customer/provider headers. Fetches the
// signed-in user's avatar_url itself, and routes to the Profile screen on tap.
export default function HeaderAvatar({ href, online, active = false }: Props) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('avatar_url, full_name')
        .eq('id', user.id)
        .single();
      // avatar_url already carries a ?t= cache-buster baked in at upload time
      // (see profile.tsx), so we use it as-is.
      if (!alive || !data) return;
      if (data.avatar_url) setAvatarUrl(data.avatar_url);
      if (data.full_name) setFullName(data.full_name);
    })();
    return () => { alive = false; };
  }, []);

  const initials = fullName ? getInitials(fullName) : '';

  return (
    <TouchableOpacity
      onPress={() => router.push(href)}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <View style={styles.wrap}>
        <Avatar
          url={avatarUrl}
          name={fullName ?? undefined}
          size={34}
          backgroundColor="#DCFCE7"
          textColor={PRIMARY}
          style={active ? styles.avatarActive : undefined}
        />
        {online != null && (
          <View style={[styles.statusDot, { backgroundColor: online ? PRIMARY : '#9CA3AF' }]} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarActive: {
    borderWidth: 2,
    borderColor: PRIMARY,
  },
  fallback: {
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { fontSize: 13, fontWeight: '700', color: PRIMARY },
  statusDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
