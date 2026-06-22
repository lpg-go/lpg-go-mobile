-- ================================================================
-- delivery_safety_checks
-- One immutable pre-delivery safety check per order, recorded by the
-- assigned rider while the order is in_transit (before "Mark as Delivered").
-- ================================================================

create table public.delivery_safety_checks (
  id          uuid        primary key default gen_random_uuid(),
  order_id    uuid        not null unique references public.orders(id)   on delete cascade,
  rider_id    uuid        not null        references public.profiles(id) on delete restrict,
  passed      boolean     not null default true,
  notes       text,
  photos      jsonb       not null default '[]'::jsonb,
  checked_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------
alter table public.delivery_safety_checks enable row level security;

-- Rider can INSERT a check only for an order they are the assigned
-- provider on, only while that order is in_transit, and only as themselves.
create policy "safety_checks: rider insert for own in_transit order"
  on public.delivery_safety_checks for insert
  with check (
    rider_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.selected_provider_id = auth.uid()
        and o.status = 'in_transit'
    )
  );

-- Customer can SELECT checks for their own orders.
create policy "safety_checks: customer read own order"
  on public.delivery_safety_checks for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.customer_id = auth.uid()
    )
  );

-- Rider can SELECT their own checks.
create policy "safety_checks: rider read own"
  on public.delivery_safety_checks for select
  using (rider_id = auth.uid());

-- Admin can SELECT all checks.
create policy "safety_checks: admin read all"
  on public.delivery_safety_checks for select
  using (public.is_admin());

-- No UPDATE or DELETE policies: checks are immutable once inserted
-- (one per order, enforced by the unique constraint on order_id, which
-- also provides the index for order_id lookups).
