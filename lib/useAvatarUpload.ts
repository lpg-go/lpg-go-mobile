import { decode } from 'base64-arraybuffer';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert } from 'react-native';

import supabase from './supabase';

// Shared avatar-upload flow for the customer + provider profile screens.
// Owns the permission → pick → upload → cache-bust → profiles.update sequence and
// the uploading flag, then hands the new URL back via onUploaded so each caller
// patches its own (differently-shaped) Profile state. The storage bucket, path,
// upsert, and ?t= cache-buster convention live here in one place.
export function useAvatarUpload(onUploaded: (url: string) => void): {
  pickAvatar: () => Promise<void>;
  isUploading: boolean;
} {
  const [isUploading, setIsUploading] = useState(false);

  async function pickAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow access to your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    if (result.canceled || !result.assets[0]?.base64) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setIsUploading(true);
    try {
      const path = `avatars/${user.id}/profile.jpg`;
      const { error } = await supabase.storage
        .from('images')
        .upload(path, decode(result.assets[0].base64), {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(path);
      const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;

      await supabase.from('profiles').update({ avatar_url: cacheBustedUrl }).eq('id', user.id);
      onUploaded(cacheBustedUrl);
    } catch (err) {
      Alert.alert('Upload failed', String(err));
    } finally {
      setIsUploading(false);
    }
  }

  return { pickAvatar, isUploading };
}
