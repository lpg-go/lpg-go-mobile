-- H8: remove unscoped in_transit branch from provider order-read policy
-- (any provider could read all in_transit orders including other customers' addresses)
DROP POLICY IF EXISTS "orders: providers read pending broadcast" ON public.orders;
CREATE POLICY "orders: providers read pending broadcast"
  ON public.orders FOR SELECT
  USING (
    (
      public.is_provider()
      AND status IN ('pending', 'awaiting_dealer_selection', 'cancelled')
      AND selected_provider_id IS NULL
    )
    OR customer_id = auth.uid()
    OR selected_provider_id = auth.uid()
    OR public.is_admin()
  );

-- M1: drop overly-permissive notifications INSERT policy
-- (WITH CHECK (true) let any authenticated user spoof notifications to any user_id)
-- Notifications are only inserted by SECURITY DEFINER triggers + service-role,
-- both of which bypass RLS — this policy granted nothing legitimate.
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;
