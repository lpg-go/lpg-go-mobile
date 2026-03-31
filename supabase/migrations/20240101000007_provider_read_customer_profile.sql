-- ============================================================
-- Allow providers to read the customer profile for any order
-- they are assigned to (selected_provider_id = auth.uid()).
-- Without this, the join customer:profiles!customer_id in the
-- provider active-delivery screen returns null due to RLS.
-- ============================================================

create policy "profiles: providers read customer for assigned order"
  on public.profiles for select
  using (
    role = 'customer'
    and exists (
      select 1 from public.orders
      where orders.customer_id          = profiles.id
        and orders.selected_provider_id = auth.uid()
    )
  );
