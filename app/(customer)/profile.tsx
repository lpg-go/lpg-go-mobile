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
import PrimaryButton from '../../components/ui/PrimaryButton';
import Card from '../../components/ui/Card';
import { confirmSignOut } from '../../lib/auth';
import { formatPhoneForDisplay } from '../../lib/format';
import { colors, radii, spacing, typography } from '../../lib/theme';
import supabase from '../../lib/supabase';
import { useAvatarUpload } from '../../lib/useAvatarUpload';

// ─── Types ────────────────────────────────────────────────────────────────────

type Profile = {
  id: string;
  full_name: string;
  phone: string;
  avatar_url: string | null;
  display_id: string | null;
  created_at: string;
};

const H_PADDING = 20;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CustomerProfileScreen() {
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const { pickAvatar, isUploading } = useAvatarUpload((url) =>
    setProfile((prev) => prev ? { ...prev, avatar_url: url } : prev)
  );

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, phone, avatar_url, display_id, created_at')
      .eq('id', user.id)
      .single();

    if (data) {
      setProfile(data as Profile);
      setEditName(data.full_name);
    }
    setLoading(false);
  }

  function startEditing() {
    setEditName(profile?.full_name ?? '');
    setEditing(true);
  }

  async function handleSave() {
    if (!profile || !editName.trim()) return;
    setSaving(true);

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: editName.trim() })
      .eq('id', profile.id);

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setProfile({ ...profile, full_name: editName.trim() });
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

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
    : '—';

  return (
    <View style={styles.screen}>
      {/* Dark header with profile block */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.titleRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={20} color={colors.headerText} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

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
            {profile?.display_id ? (
              <View style={styles.idPill}>
                <Text style={styles.idPillText}>ID: {profile.display_id}</Text>
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
        {/* Personal Information card */}
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

          <View style={styles.divider} />

          {/* Phone — read-only */}
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>Phone</Text>
              <Text style={styles.rowValueMuted}>{formatPhoneForDisplay(profile?.phone ?? '')}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Member Since — read-only */}
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>Member Since</Text>
              <Text style={styles.rowValueMuted}>{memberSince}</Text>
            </View>
          </View>
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
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Dark header + profile block
  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...typography.title, color: colors.headerText },
  profileBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
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
  profilePhone: { ...typography.body, color: colors.headerSubtext, marginTop: 2 },
  idPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: spacing.sm,
  },
  idPillText: { fontSize: 12, color: colors.headerSubtext, fontWeight: '600' },

  // Scroll — overlaps the header's bottom padding
  scroll: { flex: 1, marginTop: -24 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 0, gap: spacing.md },

  // Personal Information card
  card: {
    paddingVertical: spacing.sm,
  },
  cardLabel: {
    ...typography.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
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
