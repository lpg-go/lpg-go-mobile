-- H5/H3 final lock: all order mutations now go through SECURITY DEFINER RPCs
-- (place_order, select_provider_for_order, confirm_delivery, mark_delivered,
-- cancel_order, provider_withdraw, accept_order). The client writes no orders
-- column directly, so revoke UPDATE entirely. RPCs bypass this (SECURITY DEFINER).
REVOKE UPDATE ON public.orders FROM authenticated;

-- The "orders: customer or provider update" RLS policy is now dead: with no
-- column-level UPDATE privilege, it can never fire. Drop it for cleanliness.
DROP POLICY IF EXISTS "orders: customer or provider update" ON public.orders;
