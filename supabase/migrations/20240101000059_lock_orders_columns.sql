-- C7 fix: orders/order_items had column-blind grants letting the client set its own
-- total_amount/admin_fee/unit_price/subtotal. Order creation now goes through the
-- place_order SECURITY DEFINER RPC, so revoke the broad grants and re-grant UPDATE
-- only on columns the client still legitimately writes. Money columns (total_amount,
-- admin_fee, expires_at, delivered_at) are now locked. status/is_express/express_fee/
-- selected_provider_id stay granted for now — they'll be tightened when the
-- status-transition + express RPCs land (H5/H3).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders FROM authenticated;
GRANT UPDATE (status, payment_method, is_express, express_fee, selected_provider_id, cancelled_by, delivery_completed_at, delivery_address, delivery_lat, delivery_lng, updated_at) ON public.orders TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_items FROM authenticated;
