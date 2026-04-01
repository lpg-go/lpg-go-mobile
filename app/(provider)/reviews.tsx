import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import supabase from '../../lib/supabase';

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  customer: { full_name: string } | null;
};

const H_PADDING = 20;
const PRIMARY = '#16A34A';

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
      .select('id, rating, comment, created_at, customer:profiles!customer_id(full_name)')
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
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(provider)/profile')} style={styles.backButton} hitSlop={8}>
          <Feather name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Reviews</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PRIMARY} colors={[PRIMARY]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Average rating card */}
        {reviews.length > 0 && avgRating !== null && (
          <View style={styles.avgCard}>
            <Text style={styles.avgNumber}>{avgRating.toFixed(1)}</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Feather
                  key={s}
                  name="star"
                  size={20}
                  color={s <= Math.round(avgRating) ? '#FBBF24' : '#E5E7EB'}
                />
              ))}
            </View>
            <Text style={styles.avgSub}>
              Based on {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
            </Text>
          </View>
        )}

        {/* Review list */}
        {reviews.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="star" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>No reviews yet.{'\n'}Complete deliveries to receive ratings.</Text>
          </View>
        ) : (
          <View style={styles.reviewList}>
            {reviews.map((review, index) => (
              <ReviewRow
                key={review.id}
                review={review}
                isLast={index === reviews.length - 1}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function ReviewRow({ review, isLast }: { review: Review; isLast: boolean }) {
  const date = new Date(review.created_at).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <View style={[styles.reviewRow, !isLast && styles.reviewRowBorder]}>
      <View style={styles.reviewTop}>
        <View style={styles.reviewAvatar}>
          <Feather name="user" size={16} color={PRIMARY} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.reviewCustomer}>{review.customer?.full_name ?? 'Customer'}</Text>
          <Text style={styles.reviewDate}>{date}</Text>
        </View>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Feather key={s} name="star" size={14} color={s <= review.rating ? '#FBBF24' : '#E5E7EB'} />
          ))}
        </View>
      </View>
      {review.comment ? (
        <Text style={styles.reviewComment}>{review.comment}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PADDING,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: { width: 34 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 20 },

  // Average card
  avgCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    gap: 6,
  },
  avgNumber: { fontSize: 48, fontWeight: '800', color: '#111827', lineHeight: 56 },
  starsRow: { flexDirection: 'row', gap: 4 },
  avgSub: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },

  // Review list
  reviewList: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  reviewRow: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  reviewRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewCustomer: { fontSize: 14, fontWeight: '600', color: '#111827' },
  reviewDate: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  reviewComment: { fontSize: 13, color: '#6B7280', lineHeight: 19, paddingLeft: 42 },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 22 },
});
