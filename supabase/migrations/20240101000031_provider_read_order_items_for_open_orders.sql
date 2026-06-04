-- Allow approved providers to read order_items for any open order
-- (pending / awaiting_dealer_selection, no provider selected).
create policy "order_items: providers read items for open orders"
  on public.order_items for select
  using (
    public.is_provider()
    and exists (
      select 1 from public.orders
      where orders.id                   = order_items.order_id
        and orders.status               in ('pending', 'awaiting_dealer_selection')
        and orders.selected_provider_id is null
    )
  );
