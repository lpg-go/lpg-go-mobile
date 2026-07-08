import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../lib/theme';
import Card from '../ui/Card';

type OrderItemLike = {
  id: string | number;
  product?: { name?: string | null } | null;
  quantity: number;
  subtotal: number;
};

type Props = {
  items: OrderItemLike[];
  isExpress?: boolean;
  expressFee?: number;
  totalAmount: number;
  // "Total to pay" (customer) | "Total (COD)"/"Total (Card)" (provider).
  totalLabel: string;
  // 'pill' = detached green pill below the card (customer);
  // 'row'  = in-card total row (provider).
  totalVariant: 'pill' | 'row';
};

// Shared order-items card used by the customer order screen (OrderTracking) and
// the provider active-delivery screen. The item rows + express row are identical
// on both; only the total differs (green pill vs in-card row).
//
// NOTE: the item-name and express-fee colors had minor copy-paste drift between
// the two original screens (customer used colors.text / amberDark; provider used
// grey700 / amberText). They are keyed to `totalVariant` here so each screen
// stays pixel-identical to before — collapse to one palette later if desired.
export default function OrderItemsCard({
  items,
  isExpress = false,
  expressFee = 0,
  totalAmount,
  totalLabel,
  totalVariant,
}: Props) {
  const isPill = totalVariant === 'pill';
  const itemNameColor = isPill ? colors.text : colors.grey700;
  const amberColor = isPill ? colors.amberDark : colors.amberText;

  return (
    <>
      <Card style={styles.itemsCard}>
        {items.map((item, index) => (
          <View
            key={item.id}
            style={[styles.itemRow, index < items.length - 1 && styles.itemRowBorder]}
          >
            <Text style={[styles.itemName, { color: itemNameColor }]} numberOfLines={1}>
              {item.product?.name ?? 'Product'}
            </Text>
            <Text style={styles.itemQty}>×{item.quantity}</Text>
            <Text style={styles.itemSubtotal}>₱{Number(item.subtotal).toLocaleString()}</Text>
          </View>
        ))}

        {isExpress && (
          <View style={styles.expressFeeRow}>
            <Text style={[styles.expressFeeLabel, { color: amberColor }]}>Express delivery</Text>
            <Text style={[styles.expressFeeValue, { color: amberColor }]}>
              +₱{Number(expressFee).toLocaleString()}
            </Text>
          </View>
        )}

        {totalVariant === 'row' && (
          <View style={styles.itemTotalRow}>
            <Text style={styles.itemTotalLabel}>{totalLabel}</Text>
            <Text style={styles.itemTotalValue}>₱{Number(totalAmount).toLocaleString()}</Text>
          </View>
        )}
      </Card>

      {totalVariant === 'pill' && (
        <View style={styles.totalPill}>
          <Text style={styles.totalPillLabel}>{totalLabel}</Text>
          <Text style={styles.totalPillValue}>₱{Number(totalAmount).toLocaleString()}</Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  itemsCard: { overflow: 'hidden' },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.grey100 },
  itemName: { flex: 1, fontSize: 13 },
  itemQty: { fontSize: 13, color: colors.textMuted, marginHorizontal: spacing.md },
  itemSubtotal: { fontSize: 13, fontWeight: '600', color: colors.text, minWidth: 64, textAlign: 'right' },
  expressFeeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.grey100,
  },
  expressFeeLabel: { fontSize: 13, fontWeight: '600' },
  expressFeeValue: { fontSize: 13, fontWeight: '700' },
  itemTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.grey50,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  itemTotalLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  itemTotalValue: { fontSize: 14, fontWeight: '800', color: colors.primary },
  totalPill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  totalPillLabel: { fontSize: 14, fontWeight: '700', color: colors.primaryDark },
  totalPillValue: { ...typography.price, color: colors.primaryDark },
});
