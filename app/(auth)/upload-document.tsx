import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import supabase from '../../lib/supabase';

type ProviderType = 'dealer' | 'rider' | null;

const GREEN = '#16A34A';

export default function UploadDocumentScreen() {
  const [providerType, setProviderType] = useState<ProviderType>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [submittedDocUrl, setSubmittedDocUrl] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      supabase
        .from('profiles')
        .select('provider_type, document_url, is_approved, rejected_at, rejection_reason')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          setProviderType((data?.provider_type as ProviderType) ?? null);

          if (data?.is_approved) {
            router.replace('/(provider)');
          } else if (data?.rejected_at) {
            // Rejected — show upload form with rejection message
            setRejectionReason(data.rejection_reason ?? 'Your application was not approved.');
          } else if (data?.document_url) {
            setSubmittedDocUrl(data.document_url);
            startPolling(user.id);
          }
        });
    });

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPolling(uid: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('is_approved, rejected_at, rejection_reason')
        .eq('id', uid)
        .single();

      if (data?.is_approved) {
        clearInterval(pollRef.current!);
        Alert.alert('Approved!', 'Your account has been approved.', [
          { text: 'Continue', onPress: () => router.replace('/(provider)') },
        ]);
      } else if (data?.rejected_at) {
        clearInterval(pollRef.current!);
        setSubmittedDocUrl(null);
        setRejectionReason(data.rejection_reason ?? 'Your application was not approved.');
      }
    }, 30000);
  }

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
        .update({ document_url: publicUrl, rejected_at: null, rejection_reason: null })
        .eq('id', userId);

      if (profileError) throw profileError;

      setSubmittedDocUrl(publicUrl);
      startPolling(userId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSignOut() {
    if (pollRef.current) clearInterval(pollRef.current);
    await supabase.auth.signOut();
  }

  // ── Submitted state ──────────────────────────────────────────────────────────
  if (submittedDocUrl) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Document Submitted!</Text>
        <Text style={styles.description}>
          Your document is under review. We'll notify you once approved.
        </Text>

        <Image
          source={{ uri: submittedDocUrl }}
          style={styles.submittedPreview}
          resizeMode="cover"
        />

        <View style={styles.pollingRow}>
          <ActivityIndicator size="small" color={GREEN} />
          <Text style={styles.pollingText}>Checking approval status…</Text>
        </View>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Upload form ──────────────────────────────────────────────────────────────

  // ── Rejection banner ─────────────────────────────────────────────────────────
  const rejectionBanner = rejectionReason ? (
    <View style={styles.rejectionBanner}>
      <Text style={styles.rejectionTitle}>Application Rejected</Text>
      <Text style={styles.rejectionText}>{rejectionReason}</Text>
      <Text style={styles.rejectionSub}>Please upload a new document to reapply.</Text>
    </View>
  ) : null;

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
      {rejectionBanner}
      <Text style={styles.title}>Document Required</Text>
      <Text style={styles.description}>{descriptionText}</Text>

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

  // Success state
  submittedPreview: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
  },
  pollingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 28,
  },
  pollingText: {
    fontSize: 13,
    color: '#6B7280',
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '500',
  },

  // Upload form
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
  rejectionBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  rejectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#B91C1C',
    marginBottom: 4,
  },
  rejectionText: {
    fontSize: 14,
    color: '#7F1D1D',
    lineHeight: 20,
    marginBottom: 6,
  },
  rejectionSub: {
    fontSize: 13,
    color: '#B91C1C',
  },
});
