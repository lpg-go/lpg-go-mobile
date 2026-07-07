import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Card from '../../components/ui/Card';
import DetailHeader from '../../components/ui/DetailHeader';
import EmptyState from '../../components/ui/EmptyState';
import LoadingScreen from '../../components/ui/LoadingScreen';
import { speedLabel } from '../../lib/reviewSpeed';
import supabase from '../../lib/supabase';
import { colors, radii, spacing } from '../../lib/theme';

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  delivery_speed: string | null;
  created_at: string;
  customer: { full_name: string } | null;
};

const H_PADDING = 20;

function getInitials(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?'
  );
}

export default function ProviderReviewsScreen() {
  const insets = useSafeAreaInsets();

  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    boot();
  }, []);

  async function boot() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await fetchReviews(user.id);
    setLoading(false);
  }

  async function fetchReviews(uid: string) {
    const { data } = await supabase
      .from('reviews')
      .select('id, rating, comment, delivery_speed, created_at, customer:profiles!customer_id(full_name)')
      .eq('provider_id', uid)
      .order('created_at', { ascending: false });
    if (data) setReviews(data as unknown as Review[]);
  }

  async function handleRefresh() {
    setRefreshing(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await fetchReviews(user.id);
    setRefreshing(false);
  }

  const avgRating = reviews.length
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : null;

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <View style={styles.screen}>
      <DetailHeader
        title="My Reviews"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(provider)/profile'))}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Rating summary */}
        {reviews.length > 0 && avgRating !== null && (
          <Card style={styles.avgCard}>
            <View style={styles.avgLeft}>
              <Text style={styles.avgNumber}>{avgRating.toFixed(1)}</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Feather
                    key={s}
                    name="star"
                    size={16}
                    color={s <= Math.round(avgRating) ? colors.amber : colors.border}
                  />
                ))}
              </View>
              <Text style={styles.avgSub}>
                {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
              </Text>
            </View>

            <View style={styles.avgRight}>
              {[5, 4, 3, 2, 1].map((star) => {
                const count = reviews.filter((r) => r.rating === star).length;
                const pct = reviews.length ? (count / reviews.length) * 100 : 0;
                return (
                  <View key={star} style={styles.distRow}>
                    <Text style={styles.distStar}>{star}</Text>
                    <Feather name="star" size={10} color={colors.amber} />
                    <View style={styles.distTrack}>
                      <View style={[styles.distFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.distCount}>{count}</Text>
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {/* Review list */}
        {reviews.length === 0 ? (
          <EmptyState
            icon="star"
            message="No reviews yet"
            subtitle="Complete deliveries to receive ratings."
            style={styles.emptyPad}
          />
        ) : (
          reviews.map((review) => <ReviewCard key={review.id} review={review} />)
        )}
      </ScrollView>
    </View>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const date = new Date(review.created_at).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  });
  const label = speedLabel(review.delivery_speed);
  const isFast = review.delivery_speed === 'very_fast' || review.delivery_speed === 'fast';

  return (
    <Card style={styles.reviewCard}>
      <View style={styles.reviewTop}>
        <View style={styles.reviewIdentity}>
          <Text style={styles.reviewCustomer} numberOfLines={1}>
            {review.customer?.full_name ?? 'Customer'}
          </Text>
          <Text style={styles.reviewDate}>{date}</Text>
        </View>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Feather key={s} name="star" size={13} color={s <= review.rating ? colors.amber : colors.border} />
          ))}
        </View>
      </View>

      {review.comment ? (
        <Text style={styles.reviewComment}>{review.comment}</Text>
      ) : null}

      {label ? (
        <View style={[styles.speedPill, isFast ? styles.speedPillFast : styles.speedPillSlow]}>
          <Feather
            name={isFast ? 'zap' : 'clock'}
            size={11}
            color={isFast ? colors.primaryDark : colors.textSecondary}
          />
          <Text style={[styles.speedPillText, { color: isFast ? colors.primaryDark : colors.textSecondary }]}>
            {label}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: spacing.lg, gap: spacing.md },

  // Rating summary
  avgCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, padding: spacing.lg },
  avgLeft: { alignItems: 'center', gap: spacing.xs },
  avgNumber: { fontSize: 44, fontWeight: '800', color: colors.text, lineHeight: 50 },
  starsRow: { flexDirection: 'row', gap: 3 },
  avgSub: { fontSize: 12, color: colors.textMuted },

  avgRight: { flex: 1, gap: 5 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  distStar: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, width: 10, textAlign: 'center' },
  distTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.grey100, overflow: 'hidden' },
  distFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  distCount: { fontSize: 11, color: colors.textMuted, width: 18, textAlign: 'right' },

  // Review card
  reviewCard: { padding: spacing.lg, gap: spacing.sm },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.headerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarText: { fontSize: 13, fontWeight: '700', color: colors.headerAccent },
  reviewIdentity: { flex: 1 },
  reviewCustomer: { fontSize: 14, fontWeight: '600', color: colors.text },
  reviewDate: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  reviewComment: { fontSize: 13, color: colors.grey700, lineHeight: 18 },
  speedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  speedPillFast: { backgroundColor: colors.primaryTint },
  speedPillSlow: { backgroundColor: colors.grey100 },
  speedPillText: { fontSize: 12, fontWeight: '600' },

  // Empty state
  emptyPad: { flex: undefined, paddingTop: spacing.xxxl * 2 },
});
