import { Database } from './database.types';
import { colors } from './theme';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The order lifecycle, derived from the Postgres `order_status` enum. Adding a
 * value to the enum and regenerating `database.types.ts` will make every map
 * below fail to compile until it is handled — that is the point of deriving it.
 */
export type OrderStatus = Database['public']['Enums']['order_status'];

/** Who is looking at the order. Admins have no order-status vocabulary. */
export type OrderStatusAudience = 'customer' | 'provider';

export type OrderStatusConfig = {
  label: string;
  /** Foreground colour for the status pill's text. */
  color: string;
  /** Background colour for the status pill. */
  bg: string;
};

// ─── Base vocabulary (customer-facing) ───────────────────────────────────────

export const STATUS_CONFIG: Record<OrderStatus, OrderStatusConfig> = {
  pending:                   { label: 'Select Provider',       color: colors.primary, bg: colors.primaryTint },
  awaiting_dealer_selection: { label: 'Finding Provider',      color: colors.primary, bg: colors.primaryTint },
  in_transit:                { label: 'On the Way',            color: colors.primary, bg: colors.primaryTint },
  awaiting_confirmation:     { label: 'Awaiting Confirmation', color: colors.primary, bg: colors.primaryTint },
  delivered:                 { label: 'Delivered',             color: colors.white,   bg: colors.primary },
  cancelled:                 { label: 'Cancelled',             color: colors.white,   bg: colors.danger },
};

// ─── Provider overrides ──────────────────────────────────────────────────────

/**
 * Only where the provider's reading of a status genuinely differs from the
 * customer's. Anything absent here falls back to `STATUS_CONFIG[status].label`.
 *
 * `pending` is the one real divergence: the order is waiting on the customer to
 * pick a provider, so the customer sees a call to action ('Select Provider')
 * while the provider sees what they are doing about it ('Waiting...').
 */
export const PROVIDER_STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: 'Waiting...',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The label for a status as the given audience should read it. */
export function statusLabel(status: OrderStatus, audience: OrderStatusAudience): string {
  if (audience === 'provider') {
    return PROVIDER_STATUS_LABEL[status] ?? STATUS_CONFIG[status].label;
  }
  return STATUS_CONFIG[status].label;
}
