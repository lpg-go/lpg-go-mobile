-- ============================================================
-- Clean up stale test orders
-- Removes all orders placed by the test customer account
-- so the provider incoming orders screen starts fresh
-- ============================================================

delete from public.order_items
  where order_id in (
    select id from public.orders
    where customer_id = 'b0000000-0000-0000-0000-000000000001'
  );

delete from public.order_acceptances
  where order_id in (
    select id from public.orders
    where customer_id = 'b0000000-0000-0000-0000-000000000001'
  );

delete from public.messages
  where order_id in (
    select id from public.orders
    where customer_id = 'b0000000-0000-0000-0000-000000000001'
  );

delete from public.orders
  where customer_id = 'b0000000-0000-0000-0000-000000000001';
