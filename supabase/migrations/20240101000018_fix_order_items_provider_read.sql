-- Allow providers to read order_items for pending/broadcast orders
-- so they can filter which orders they can fulfil.
-- Previously only customer_id and selected_provider_id could read items,
-- but selected_provider_id is NULL on incoming orders so providers saw
-- empty order_items arrays and the client-side filter showed nothing.
create policy "order_items: providers read pending orders"
  on public.order_items for select
  using (
    public.is_provider()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.status in ('pending', 'awaiting_dealer_selection')
    )
  );
