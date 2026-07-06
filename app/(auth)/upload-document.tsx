import { Feather } from '@expo/vector-icons';
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

import Card from '../../components/ui/Card';
import DetailHeader from '../../components/ui/DetailHeader';
import PrimaryButton from '../../components/ui/PrimaryButton';
import StatusBadge from '../../components/ui/StatusBadge';
import supabase from '../../lib/supabase';
import { colors, radii, spacing } from '../../lib/theme';

type ProviderType = 'dealer' | 'rider' | null;

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
        .then(async ({ data }) => {
          setProviderType((data?.provider_type as ProviderType) ?? null);

          if (data?.is_approved) {
            router.replace('/(provider)');
          } else if (data?.rejected_at) {
            // Rejected — show upload form with rejection message
            setRejectionReason(data.rejection_reason ?? 'Your application was not approved.');
          } else if (data?.document_url) {
            // document_url is a storage path in the private bucket — sign it to preview.
            const { data: signed } = await supabase.storage
              .from('documents')
              .createSignedUrl(data.document_url, 3600);
            setSubmittedDocUrl(signed?.signedUrl ?? null);
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
      const storagePath = `${userId}/document.${ext}`;

      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, arrayBuffer, { contentType, upsert: true });

      if (uploadError) throw uploadError;

      // Store the storage PATH (private bucket — no public URL).
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ document_url: storagePath, rejected_at: null, rejection_reason: null })
        .eq('id', userId);

      if (profileError) throw profileError;

      // Signed URL for the submitted-state preview (1h expiry).
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(storagePath, 3600);

      setSubmittedDocUrl(signed?.signedUrl ?? null);
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

  // ── Submitted / under-review state ────────────────────────────────────────────
  if (submittedDocUrl) {
    return (
      <View style={styles.screen}>
        <DetailHeader title="Verification" />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Card style={styles.reviewCard}>
            <View style={styles.reviewTop}>
              <Text style={styles.cardTitle}>Document submitted</Text>
              <StatusBadge label="Under review" tone="review" />
            </View>
            <Text style={styles.description}>
              Your document is under review. We'll notify you once approved.
            </Text>
            <Image source={{ uri: submittedDocUrl }} style={styles.submittedPreview} resizeMode="cover" />
            <View style={styles.pollingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.pollingText}>Checking approval status…</Text>
            </View>
          </Card>

          <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} activeOpacity={0.8}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Upload form ──────────────────────────────────────────────────────────────
  const descriptionText =
    providerType === 'rider'
      ? "Please upload your Driver's License to complete your registration."
      : "Please upload any one of the following to complete your registration: Mayor's Permit, DTI, or SEC registration.";

  return (
    <View style={styles.screen}>
      <DetailHeader title="Verification" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {rejectionReason ? (
          <Card style={styles.rejectionCard}>
            <View style={styles.reviewTop}>
              <Text style={styles.rejectionTitle}>Application rejected</Text>
              <StatusBadge label="Rejected" tone="danger" />
            </View>
            <Text style={styles.rejectionText}>{rejectionReason}</Text>
            <Text style={styles.rejectionSub}>Please upload a new document to reapply.</Text>
          </Card>
        ) : null}

        <Text style={styles.title}>Document required</Text>
        <Text style={styles.description}>{descriptionText}</Text>

        <TouchableOpacity style={styles.pickCard} onPress={pickImage} activeOpacity={0.7}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
          ) : (
            <View style={styles.pickPlaceholder}>
              <Feather name="upload-cloud" size={34} color={colors.primary} />
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

        {!!error && (
          <View style={styles.errorCard}>
            <Feather name="alert-circle" size={14} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.submitWrap}>
          <PrimaryButton label="Submit for Review" onPress={handleSubmit} loading={uploading} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xxl, paddingTop: spacing.xl, paddingBottom: 40 },

  title: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  description: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.lg },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },

  // Review (under-review) card
  reviewCard: { padding: spacing.lg, marginBottom: spacing.lg },
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  submittedPreview: {
    width: '100%',
    height: 220,
    borderRadius: radii.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  pollingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pollingText: { fontSize: 13, color: colors.textSecondary },

  signOutButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  signOutText: { color: colors.textSecondary, fontSize: 15, fontWeight: '500' },

  // Upload area
  pickCard: {
    width: '100%',
    height: 200,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.card,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  pickPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: spacing.lg },
  pickLabel: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: spacing.xs },
  pickSub: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  preview: { width: '100%', height: '100%' },
  changeLink: { alignSelf: 'center', marginBottom: spacing.md },
  changeLinkText: { fontSize: 14, color: colors.primary, fontWeight: '600' },

  submitWrap: { marginTop: spacing.sm },

  // Rejection card
  rejectionCard: { padding: spacing.lg, marginBottom: spacing.lg, backgroundColor: colors.dangerTint, borderColor: colors.dangerBorder },
  rejectionTitle: { fontSize: 15, fontWeight: '700', color: colors.danger },
  rejectionText: { fontSize: 14, color: colors.danger, lineHeight: 20, marginBottom: spacing.xs },
  rejectionSub: { fontSize: 13, color: colors.danger, opacity: 0.85 },

  // Error
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerTint,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: 13, color: colors.danger },
});
