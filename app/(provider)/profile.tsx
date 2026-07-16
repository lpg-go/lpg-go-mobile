import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '../../components/ui/Avatar';
import Card from '../../components/ui/Card';
import DetailHeader from '../../components/ui/DetailHeader';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { confirmSignOut } from '../../lib/auth';
import { formatPhoneForDisplay } from '../../lib/format';
import supabase from '../../lib/supabase';
import { colors, radii, spacing, typography } from '../../lib/theme';
import { useAvatarUpload } from '../../lib/useAvatarUpload';

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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProviderProfileScreen() {
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBusiness, setEditBusiness] = useState('');
  const [saving, setSaving] = useState(false);
  const { pickAvatar, isUploading } = useAvatarUpload((url) =>
    setProfile((prev) => prev ? { ...prev, avatar_url: url } : prev)
  );
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
        <TouchableOpacity onPress={pickAvatar} disabled={isUploading} activeOpacity={0.8}>
          <View style={styles.avatarWrap}>
            {isUploading ? (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : (
              <Avatar
                url={profile?.avatar_url}
                name={profile?.full_name}
                size={AVATAR}
                backgroundColor={colors.primary}
                textColor="#fff"
                style={styles.avatar}
              />
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
              <Text style={styles.rowValueMuted}>{formatPhoneForDisplay(profile?.phone ?? '')}</Text>
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

        {/* Support / legal */}
        <Card style={styles.card}>
          <TouchableOpacity
            style={styles.linkRow}
            // TODO: replace with real support destination (email/URL) before launch
            onPress={() => Linking.openURL('https://iscalestudio.com')}
            activeOpacity={0.7}
          >
            <Feather name="help-circle" size={16} color={colors.textSecondary} />
            <Text style={styles.linkLabel}>Help & support</Text>
            <Feather name="chevron-right" size={18} color={colors.textFaint} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.linkRow}
            // TODO: replace with real terms/privacy URL before launch
            onPress={() => Linking.openURL('https://iscalestudio.com')}
            activeOpacity={0.7}
          >
            <Feather name="file-text" size={16} color={colors.textSecondary} />
            <Text style={styles.linkLabel}>Terms & privacy</Text>
            <Feather name="chevron-right" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        </Card>

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

  // Support / legal link rows (match the info-card row padding)
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  linkLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },

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
