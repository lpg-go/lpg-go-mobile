-- When an order is cancelled its status no longer matches the provider's
-- existing SELECT policy (status IN ('pending','awaiting_dealer_selection')),
-- so Supabase Realtime never delivers the UPDATE event to watching providers.
-- The cancelled card then stays in the "New Requests" list until a manual
-- refresh.
--
-- Fix: extend the broadcast policy to also cover cancelled, unassigned orders
-- so providers receive the realtime UPDATE and can remove the card immediately.

drop policy if exists "orders: providers read pending broadcast" on public.orders;

create policy "orders: providers read pending broadcast"
  on public.orders for select
  using (
    (
      public.is_provider()
      and status in ('pending', 'awaiting_dealer_selection', 'cancelled')
      and selected_provider_id is null
    )
    or customer_id = auth.uid()
    or selected_provider_id = auth.uid()
    or public.is_admin()
  );
