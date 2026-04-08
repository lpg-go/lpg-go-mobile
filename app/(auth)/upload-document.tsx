import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import supabase from '../../lib/supabase';

type ProviderType = 'dealer' | 'rider' | null;
type DealerDocType = 'dti' | 'sec';

const GREEN = '#16A34A';

export default function UploadDocumentScreen() {
  const [providerType, setProviderType] = useState<ProviderType>(null);
  const [dealerDocType, setDealerDocType] = useState<DealerDocType>('dti');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      supabase
        .from('profiles')
        .select('provider_type')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          setProviderType((data?.provider_type as ProviderType) ?? null);
        });
    });
  }, []);

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Permission to access photos is required.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });

    if (!result.canceled) {
      setImageUri(result.assets[0].uri);
      setError('');
    }
  }

  async function handleSubmit() {
    if (!imageUri) {
      setError('Please select a document image first.');
      return;
    }
    if (!userId) {
      setError('Not authenticated.');
      return;
    }

    setUploading(true);
    setError('');

    try {
      const uri = imageUri;
      const ext = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const storagePath = `documents/${userId}/document.${ext}`;

      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(storagePath, arrayBuffer, { contentType, upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('images')
        .getPublicUrl(storagePath);

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ document_url: publicUrl })
        .eq('id', userId);

      if (profileError) throw profileError;

      router.replace('/(auth)/pending-approval');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  const descriptionText =
    providerType === 'rider'
      ? "Please upload your Driver's License to complete your registration."
      : 'Please upload your DTI or SEC registration document to complete your registration.';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Logo */}
      <View style={styles.logoWrap}>
        <View style={styles.logoBox}>
          <Text style={styles.logoText}>L</Text>
        </View>
        <Text style={styles.appName}>LPG Go</Text>
      </View>

      <Text style={styles.title}>Document Required</Text>
      <Text style={styles.description}>{descriptionText}</Text>

      {/* Dealer: doc type selector */}
      {providerType === 'dealer' && (
        <View style={styles.docTypeRow}>
          <DocTypeButton
            label="DTI Certificate"
            selected={dealerDocType === 'dti'}
            onPress={() => setDealerDocType('dti')}
          />
          <DocTypeButton
            label="SEC Registration"
            selected={dealerDocType === 'sec'}
            onPress={() => setDealerDocType('sec')}
          />
        </View>
      )}

      {/* Image preview / pick button */}
      <TouchableOpacity style={styles.pickButton} onPress={pickImage} activeOpacity={0.7}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
        ) : (
          <View style={styles.pickPlaceholder}>
            <Text style={styles.pickIcon}>📄</Text>
            <Text style={styles.pickLabel}>Tap to select document</Text>
            <Text style={styles.pickSub}>Take a photo or upload an image of your document</Text>
          </View>
        )}
      </TouchableOpacity>

      {imageUri && (
        <TouchableOpacity onPress={pickImage} style={styles.changeLink}>
          <Text style={styles.changeLinkText}>Change image</Text>
        </TouchableOpacity>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.submitButton, uploading && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={uploading}
        activeOpacity={0.8}
      >
        {uploading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>Submit for Review</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

function DocTypeButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.docTypeBtn, selected && styles.docTypeBtnSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.docTypeBtnText, selected && styles.docTypeBtnTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 40,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
  },
  appName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
    marginBottom: 24,
  },
  docTypeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  docTypeBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  docTypeBtnSelected: {
    borderColor: GREEN,
    backgroundColor: '#F0FDF4',
  },
  docTypeBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
  },
  docTypeBtnTextSelected: {
    color: GREEN,
  },
  pickButton: {
    width: '100%',
    height: 200,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    overflow: 'hidden',
    marginBottom: 8,
  },
  pickPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pickIcon: {
    fontSize: 36,
  },
  pickLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#374151',
  },
  pickSub: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  changeLink: {
    alignSelf: 'center',
    marginBottom: 16,
  },
  changeLinkText: {
    fontSize: 14,
    color: GREEN,
    fontWeight: '500',
  },
  error: {
    color: '#EF4444',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
