-- When the customer selects a provider the order transitions from
-- (status='awaiting_dealer_selection', selected_provider_id=NULL)  →
-- (status='in_transit', selected_provider_id=<chosen provider>)
-- in a single UPDATE.
--
-- After that write, other providers fail every clause of the existing policy:
--   • status NOT IN ('pending','awaiting_dealer_selection','cancelled') ✗
--   • selected_provider_id != auth.uid()                               ✗
-- So Realtime drops the event and the order stays in their list.
--
-- Fix: add 'in_transit' to the broadcast status list so the post-update
-- row is still visible to providers and Realtime can deliver the event.
-- The client-side isAssigned guard then removes it from local state.

drop policy if exists "orders: providers read pending broadcast" on public.orders;

create policy "orders: providers read pending broadcast"
  on public.orders for select
  using (
    (
      public.is_provider()
      and status in ('pending', 'awaiting_dealer_selection', 'in_transit', 'cancelled')
      and selected_provider_id is null
    )
    or (
      public.is_provider()
      and status = 'in_transit'
    )
    or customer_id = auth.uid()
    or selected_provider_id = auth.uid()
    or public.is_admin()
  );
