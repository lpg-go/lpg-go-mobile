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
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Card from '../../components/ui/Card';
import DetailHeader from '../../components/ui/DetailHeader';
import PrimaryButton from '../../components/ui/PrimaryButton';
import supabase from '../../lib/supabase';
import { colors, radii, spacing, typography } from '../../lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type Profile = {
  id: string;
  full_name: string;
  phone: string;
  avatar_url: string | null;
  provider_type: 'dealer' | 'rider';
  business_name: string | null;
  avg_delivery_minutes: number | null;
  display_id: string | null;
  loyalty_tier: string | null;
  created_at: string;
  is_online: boolean;
};

// VIP loyalty tier → pill color. Tier value from DB is lowercase.
const TIER_COLORS: Record<string, string> = {
  bronze: '#CD7F32',
  silver: '#9CA3AF',
  gold: '#D4AF37',
  platinum: '#64748B',
};

const H_PADDING = 20;

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
  const [togglingOnline, setTogglingOnline] = useState(false);

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
      .select('id, full_name, phone, avatar_url, provider_type, business_name, avg_delivery_minutes, display_id, loyalty_tier, created_at, is_online')
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

  async function handleToggleOnline(value: boolean) {
    if (!profile) return;
    setTogglingOnline(true);
    const { error } = await supabase
      .from('profiles')
      .update({ is_online: value })
      .eq('id', profile.id);
    setTogglingOnline(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setProfile((prev) => prev ? { ...prev, is_online: value } : prev);
    }
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
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isDealer = profile?.provider_type === 'dealer';
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
    : '—';

  return (
    <View style={styles.screen}>
      <DetailHeader
        title="Profile"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(provider)'))}
      />

      {/* Dark profile block (continues the header) */}
      <View style={styles.profileBlock}>
        <TouchableOpacity onPress={handlePickAvatar} disabled={uploadingAvatar} activeOpacity={0.8}>
          <View style={styles.avatarWrap}>
            {uploadingAvatar ? (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : profile?.avatar_url ? (
              <Image key={profile.avatar_url} source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
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

        <View style={styles.profileInfo}>
          <Text style={styles.profileName} numberOfLines={1}>{profile?.full_name}</Text>
          <Text style={styles.profileRole}>{isDealer ? 'Dealer' : 'Rider'}</Text>
          <View style={styles.pillsRow}>
            {profile?.display_id ? (
              <View style={styles.idPill}>
                <Text style={styles.idPillText}>ID: {profile.display_id}</Text>
              </View>
            ) : null}
            {profile?.loyalty_tier ? (
              <View style={[styles.tierBadge, { backgroundColor: TIER_COLORS[profile.loyalty_tier] ?? '#9CA3AF' }]}>
                <Text style={styles.tierBadgeText}>
                  {profile.loyalty_tier.charAt(0).toUpperCase() + profile.loyalty_tier.slice(1)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Online status */}
        <Card style={styles.card}>
          <View style={styles.statusRow}>
            <View style={styles.rowBody}>
              <Text style={styles.statusLabel}>Online status</Text>
              <Text style={styles.statusHint}>You'll receive order requests when online.</Text>
            </View>
            <View style={styles.statusRight}>
              <Text style={[styles.statusValue, { color: profile?.is_online ? colors.primary : colors.textMuted }]}>
                {profile?.is_online ? 'Online' : 'Offline'}
              </Text>
              <Switch
                value={!!profile?.is_online}
                onValueChange={handleToggleOnline}
                disabled={togglingOnline}
                trackColor={{ false: colors.grey300, true: colors.primary }}
                thumbColor="#fff"
                ios_backgroundColor={colors.grey300}
              />
            </View>
          </View>
        </Card>

        {/* Personal Information */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Personal Information</Text>

          {/* Full Name — editable */}
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>Full Name</Text>
              {editing ? (
                <TextInput
                  style={styles.textInput}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Full name"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />
              ) : (
                <Text style={styles.rowValue}>{profile?.full_name ?? '—'}</Text>
              )}
            </View>
            {!editing && (
              <TouchableOpacity onPress={startEditing} hitSlop={8} activeOpacity={0.7}>
                <Feather name="edit-2" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Business Name — dealers only */}
          {isDealer && editing ? (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel}>Business Name</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editBusiness}
                    onChangeText={setEditBusiness}
                    placeholder="Business name"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              </View>
            </>
          ) : isDealer && profile?.business_name ? (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel}>Business Name</Text>
                  <Text style={styles.rowValue}>{profile.business_name}</Text>
                </View>
              </View>
            </>
          ) : null}

          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>Phone</Text>
              <Text style={styles.rowValueMuted}>{formatPhone(profile?.phone ?? '')}</Text>
            </View>
          </View>

          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>Member Since</Text>
              <Text style={styles.rowValueMuted}>{memberSince}</Text>
            </View>
          </View>

          {profile?.avg_delivery_minutes != null && (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel}>Avg Delivery Time</Text>
                  <Text style={styles.rowValueMuted}>{profile.avg_delivery_minutes} mins</Text>
                </View>
              </View>
            </>
          )}

          {avgRating !== null && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push('/(provider)/reviews' as never)}
                activeOpacity={0.7}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel}>Avg Rating</Text>
                  <View style={styles.ratingValueRow}>
                    <Feather name="star" size={13} color={colors.amber} />
                    <Text style={styles.rowValue}>
                      {avgRating.toFixed(1)} / 5 ({reviewCount} {reviewCount === 1 ? 'review' : 'reviews'})
                    </Text>
                  </View>
                </View>
                <Feather name="chevron-right" size={18} color={colors.textFaint} />
              </TouchableOpacity>
            </>
          )}
        </Card>

        {/* Save / Cancel — only while editing */}
        {editing && (
          <View style={styles.editActions}>
            <View style={styles.editActionBtn}>
              <PrimaryButton label="Save" onPress={handleSave} loading={saving} />
            </View>
            <View style={styles.editActionBtn}>
              <PrimaryButton label="Cancel" variant="outline" onPress={() => setEditing(false)} />
            </View>
          </View>
        )}

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutCard} onPress={confirmSignOut} activeOpacity={0.8}>
          <Feather name="log-out" size={18} color={colors.danger} />
          <Text style={styles.signOutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const AVATAR = 64;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Dark profile block (continues below DetailHeader)
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarFallback: { backgroundColor: colors.primary },
  avatarInitials: { fontSize: 22, fontWeight: '800', color: '#fff' },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.headerBg,
  },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 19, fontWeight: '700', color: colors.headerText },
  profileRole: { ...typography.body, color: colors.headerSubtext, marginTop: 2 },
  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  idPill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  idPillText: { fontSize: 12, color: colors.headerSubtext, fontWeight: '600' },
  tierBadge: { borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tierBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff', letterSpacing: 0.3 },

  // Scroll — overlaps the header's bottom padding
  scroll: { flex: 1, marginTop: -24 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 0, gap: spacing.md },

  // Card
  card: { paddingVertical: spacing.sm },
  cardLabel: {
    ...typography.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },

  // Online status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  statusLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  statusHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statusRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusValue: { fontSize: 13, fontWeight: '700' },

  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowBody: { flex: 1 },
  rowLabel: { ...typography.label, color: colors.textMuted, marginBottom: 3 },
  rowValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowValueMuted: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  ratingValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  divider: { height: 1, backgroundColor: colors.cardBorder, marginHorizontal: spacing.lg },

  textInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },

  // Save / Cancel
  editActions: { flexDirection: 'row', gap: spacing.sm },
  editActionBtn: { flex: 1 },

  // Sign out
  signOutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.md,
    paddingVertical: spacing.lg,
  },
  signOutText: { fontSize: 15, fontWeight: '500', color: colors.danger },
});
