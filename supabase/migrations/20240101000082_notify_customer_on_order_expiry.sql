-- Notify customers when their order expires.
--
-- expire_pending_orders() (migration 017) auto-cancels unaccepted orders via the
-- every-minute `expire-pending-orders` pg_cron job, but only flips the row to
-- cancelled/system — the customer was never told. This replaces the function so
-- it ALSO writes an in-app notification for each affected customer in the SAME
-- transaction (a CTE over the UPDATE ... RETURNING rows).
--
-- Notification columns match public.notifications (migration 028): user_id,
-- title, body, type, order_id (is_read + created_at use their defaults). `type`
-- follows the event-string convention used by the order-notifications edge
-- function (dealer_accepted, in_transit, order_cancelled, …); here: order_expired.
--
-- The cron.schedule entry is left untouched — only the function body changes.

CREATE OR REPLACE FUNCTION public.expire_pending_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public   -- matches the fix in migration 068
AS $$
BEGIN
  WITH expired AS (
    UPDATE public.orders
    SET
      status = 'cancelled',
      cancelled_by = 'system',
      cancel_reason = 'Order expired - no provider accepted in time'
    WHERE
      status IN ('pending', 'awaiting_dealer_selection')
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    RETURNING id, customer_id
  )
  INSERT INTO public.notifications (user_id, title, body, type, order_id)
  SELECT
    customer_id,
    'Order expired',
    'No provider accepted your order in time. Tap to place a new order.',
    'order_expired',
    id
  FROM expired
  WHERE customer_id IS NOT NULL;
END;
$$;
