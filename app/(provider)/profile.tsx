import { Feather } from '@expo/vector-icons';
import { decode } from 'base64-arraybuffer';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import supabase from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type Profile = {
  id: string;
  full_name: string;
  phone: string;
  avatar_url: string | null;
  provider_type: 'dealer' | 'rider';
  business_name: string | null;
  avg_delivery_minutes: number | null;
  created_at: string;
};

const H_PADDING = 20;
const PRIMARY = '#16A34A';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('63') && d.length === 12) {
    return `+63 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  }
  return phone;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProviderProfileScreen() {
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBusiness, setEditBusiness] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    fetchProfile();
  }, []);

  // Re-fetch review stats whenever a new review is inserted for this provider
  useEffect(() => {
    let uid: string | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      uid = user.id;

      const channel = supabase
        .channel('provider-profile-reviews')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'reviews', filter: `provider_id=eq.${uid}` },
          () => fetchReviewStats(uid!)
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    });
  }, []);

  async function fetchProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, phone, avatar_url, provider_type, business_name, avg_delivery_minutes, created_at')
      .eq('id', user.id)
      .single();

    if (data) {
      setProfile(data as Profile);
      setEditName(data.full_name);
      setEditBusiness(data.business_name ?? '');
    }

    await fetchReviewStats(user.id);
    setLoading(false);
  }

  async function fetchReviewStats(uid: string) {
    const { data: reviewData } = await supabase
      .from('reviews')
      .select('rating')
      .eq('provider_id', uid);

    if (reviewData && reviewData.length > 0) {
      const avg = reviewData.reduce((sum, r) => sum + r.rating, 0) / reviewData.length;
      setAvgRating(avg);
      setReviewCount(reviewData.length);
    } else {
      setAvgRating(null);
      setReviewCount(0);
    }
  }

  async function handlePickAvatar() {
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

    setUploadingAvatar(true);
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
      setProfile((prev) => prev ? { ...prev, avatar_url: cacheBustedUrl } : prev);
    } catch (err) {
      Alert.alert('Upload failed', String(err));
    } finally {
      setUploadingAvatar(false);
    }
  }

  function startEditing() {
    setEditName(profile?.full_name ?? '');
    setEditBusiness(profile?.business_name ?? '');
    setEditing(true);
  }

  async function handleSave() {
    if (!profile || !editName.trim()) return;
    setSaving(true);

    const updates: Record<string, string> = { full_name: editName.trim() };
    if (profile.provider_type === 'dealer') {
      updates.business_name = editBusiness.trim();
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile.id);

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setProfile({
      ...profile,
      full_name: editName.trim(),
      business_name: profile.provider_type === 'dealer' ? editBusiness.trim() : profile.business_name,
    });
    setEditing(false);
  }

  function confirmSignOut() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
      ]
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  const isDealer = profile?.provider_type === 'dealer';
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
    : '—';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Profile</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handlePickAvatar} disabled={uploadingAvatar} activeOpacity={0.8}>
            <View style={styles.avatarWrap}>
              {uploadingAvatar ? (
                <View style={[styles.avatar, { backgroundColor: PRIMARY }]}>
                  <ActivityIndicator size="large" color="#fff" />
                </View>
              ) : profile?.avatar_url ? (
                <Image key={profile.avatar_url} source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: PRIMARY }]}>
                  <Text style={styles.avatarInitials}>
                    {profile ? getInitials(profile.full_name) : '?'}
                  </Text>
                </View>
              )}
              <View style={styles.cameraOverlay}>
                <Feather name="camera" size={12} color="#fff" />
              </View>
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarName}>{profile?.full_name}</Text>
          <Text style={styles.avatarSub}>{isDealer ? 'Dealer' : 'Rider'}</Text>
        </View>

        {/* Personal info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <View style={styles.card}>
            {editing ? (
              <>
                <View style={styles.editFieldWrap}>
                  <Text style={styles.editFieldLabel}>Full Name</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Full name"
                    placeholderTextColor="#9CA3AF"
                    autoFocus
                  />
                </View>
                {isDealer && (
                  <>
                    <View style={styles.rowDivider} />
                    <View style={styles.editFieldWrap}>
                      <Text style={styles.editFieldLabel}>Business Name</Text>
                      <TextInput
                        style={styles.textInput}
                        value={editBusiness}
                        onChangeText={setEditBusiness}
                        placeholder="Business name"
                        placeholderTextColor="#9CA3AF"
                      />
                    </View>
                  </>
                )}
              </>
            ) : (
              <>
                <InfoRow icon="user" label="Full Name" value={profile?.full_name ?? '—'} />
                {isDealer && profile?.business_name ? (
                  <>
                    <View style={styles.rowDivider} />
                    <InfoRow icon="briefcase" label="Business Name" value={profile.business_name} />
                  </>
                ) : null}
              </>
            )}
            <View style={styles.rowDivider} />
            <InfoRow icon="phone" label="Phone" value={formatPhone(profile?.phone ?? '')} />
            <View style={styles.rowDivider} />
            <InfoRow icon="calendar" label="Member Since" value={memberSince} />
            {profile?.avg_delivery_minutes != null && (
              <>
                <View style={styles.rowDivider} />
                <InfoRow
                  icon="clock"
                  label="Avg Delivery Time"
                  value={`${profile.avg_delivery_minutes} mins`}
                />
              </>
            )}
            {avgRating !== null && (
              <>
                <View style={styles.rowDivider} />
                <TouchableOpacity onPress={() => router.push('/(provider)/reviews' as never)} activeOpacity={0.7}>
                  <InfoRow
                    icon="star"
                    label="Avg Rating"
                    value={`${avgRating.toFixed(1)} / 5 (${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'})`}
                  />
                </TouchableOpacity>
              </>
            )}
          </View>

          {editing ? (
            <View style={styles.editActions}>
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.editBtn} onPress={startEditing}>
              <Feather name="edit-2" size={14} color={PRIMARY} />
              <Text style={styles.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={confirmSignOut} activeOpacity={0.8}>
          <Feather name="log-out" size={18} color="#EF4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Info row ─────────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon as any} size={16} color="#9CA3AF" />
      <View style={styles.infoRowBody}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    paddingHorizontal: H_PADDING,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 24 },

  // Avatar section
  avatarSection: { alignItems: 'center', marginBottom: 28 },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  avatarInitials: { fontSize: 28, fontWeight: '800', color: '#fff' },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F9FAFB',
  },
  avatarName: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 2 },
  avatarSub: { fontSize: 13, color: '#9CA3AF' },

  // Section
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  rowDivider: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 48 },

  // Info row
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  infoRowBody: { flex: 1 },
  infoLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '500', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#111827' },

  // Edit field
  editFieldWrap: { paddingHorizontal: 16, paddingVertical: 14 },
  editFieldLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '500', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  textInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },

  // Edit / save / cancel
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
  },
  editBtnText: { fontSize: 13, fontWeight: '600', color: PRIMARY },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  saveBtn: {
    flex: 1,
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },

  // Sign out
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: '#FFF5F5',
  },
  signOutText: { fontSize: 15, fontWeight: '700', color: '#EF4444' },
});
