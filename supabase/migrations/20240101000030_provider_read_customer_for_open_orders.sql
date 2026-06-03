-- Allow approved providers to read the customer profile for any
-- open order (pending / awaiting_dealer_selection with no provider
-- selected). Needed so the "Incoming Orders" list can show the
-- customer's name before the provider accepts.

create policy "profiles: providers read customer for open orders"
  on public.profiles for select
  using (
    role = 'customer'
    and public.is_provider()
    and exists (
      select 1 from public.orders
      where orders.customer_id          = profiles.id
        and orders.status               in ('pending', 'awaiting_dealer_selection')
        and orders.selected_provider_id is null
    )
  );
