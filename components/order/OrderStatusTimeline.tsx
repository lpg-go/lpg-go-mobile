import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography, shadows } from '../../lib/theme';

// ─── Types ───────────────────────────────────────────────────────────────────

type OrderStatus =
  | 'pending'
  | 'awaiting_dealer_selection'
  | 'in_transit'
  | 'awaiting_confirmation'
  | 'delivered'
  | 'cancelled';

export type OrderStatusTimelineProps = {
  status: OrderStatus;
  placedAt: string;
  deliveryAddress?: string;
  isExpress?: boolean;
  etaDeadline?: string | null;
  etaMinutes?: number | null;
  /** Render the map-pin + address row at the bottom. Defaults to true. */
  showAddress?: boolean;
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function OrderStatusTimeline({
  status,
  placedAt,
  deliveryAddress,
  isExpress,
  etaDeadline,
  etaMinutes,
  showAddress = true,
}: OrderStatusTimelineProps) {
  // Timeline progress — how far the order has advanced.
  //   pending / awaiting_dealer_selection → node 1
  //   in_transit                          → nodes 1+2
  //   awaiting_confirmation / delivered   → all nodes
  const stageIndex =
    status === 'in_transit'
      ? 1
      : status === 'awaiting_confirmation' || status === 'delivered'
      ? 2
      : 0;
  const stages: { label: string; icon: keyof typeof Feather.glyphMap; time: string | null }[] = [
    { label: 'Order confirmed', icon: 'check', time: placedAt },
    { label: 'Rider on the way', icon: 'truck', time: null },
    { label: 'Delivered', icon: 'package', time: null },
  ];

  const etaTime = etaDeadline
    ? new Date(etaDeadline).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <View style={styles.trackCard}>
      {isExpress && etaTime && etaMinutes != null && (
        <View style={styles.etaRow}>
          <Feather name="zap" size={14} color={colors.amberDark} />
          <Text style={styles.etaText}>
            Deliver by {etaTime} · ~{etaMinutes} min
          </Text>
        </View>
      )}
      {stages.map((stage, i) => {
        const active = i <= stageIndex;
        const isLast = i === stages.length - 1;
        const connectorActive = i < stageIndex;
        return (
          <View key={stage.label} style={styles.timelineRow}>
            <View style={styles.timelineLeft}>
              <View style={[styles.node, active ? styles.nodeActive : styles.nodeFuture]}>
                <Feather name={stage.icon} size={14} color={active ? '#fff' : colors.textFaint} />
              </View>
              {!isLast && (
                <View
                  style={[
                    styles.connector,
                    connectorActive ? styles.connectorActive : styles.connectorFuture,
                  ]}
                />
              )}
            </View>
            <View style={styles.timelineText}>
              <Text style={[styles.timelineLabel, !active && styles.timelineLabelFuture]}>
                {stage.label}
              </Text>
              {active && stage.time ? (
                <Text style={styles.timelineTime}>{stage.time}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
      {showAddress && (
        <View style={styles.trackAddressRow}>
          <Feather name="map-pin" size={14} color={colors.textMuted} />
          <Text style={styles.trackAddressText} numberOfLines={2}>
            {deliveryAddress}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  trackCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.amberTint,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  etaText: { fontSize: 13, fontWeight: '700', color: colors.amberDark },

  timelineRow: { flexDirection: 'row' },
  timelineLeft: { alignItems: 'center', width: 28 },
  node: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeActive: { backgroundColor: colors.primary },
  nodeFuture: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.card },
  connector: { width: 2, height: 22 },
  connectorActive: { backgroundColor: colors.primary },
  connectorFuture: { backgroundColor: colors.border },
  timelineText: { flex: 1, marginLeft: spacing.md, paddingTop: 4 },
  timelineLabel: { ...typography.cardTitle, color: colors.text },
  timelineLabelFuture: { color: colors.textFaint, fontWeight: '400' },
  timelineTime: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  trackAddressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  trackAddressText: { flex: 1, ...typography.body, color: colors.textSecondary },
});
