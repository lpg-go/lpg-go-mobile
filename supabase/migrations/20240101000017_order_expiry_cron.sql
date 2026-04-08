-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function to expire pending orders past their expiry time
CREATE OR REPLACE FUNCTION expire_pending_orders()
RETURNS void AS $$
BEGIN
  UPDATE public.orders
  SET
    status = 'cancelled',
    cancelled_by = 'system',
    cancel_reason = 'Order expired - no provider accepted in time'
  WHERE
    status IN ('pending', 'awaiting_dealer_selection')
    AND expires_at IS NOT NULL
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule cron job to run every minute
SELECT cron.schedule(
  'expire-pending-orders',
  '* * * * *',
  'SELECT expire_pending_orders()'
);
