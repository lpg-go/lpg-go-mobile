-- ============================================================================
-- Money-path TOCTOU: freeze the provider's quoted price at accept time
--
-- THE BUG
-- -------
-- The customer's bidding list computed each provider's total client-side from
-- the LIVE provider_products.price (app/(customer)/order/[id].tsx), and
-- select_provider_for_order then INDEPENDENTLY re-read that same live price at
-- commit (migration 083, section 2). Nothing bound the two reads together, and
-- order_acceptances stored no price at all (initial_schema:107-114 — only
-- order_id, provider_id, accepted_at, withdrawn_at).
--
-- A provider legitimately controls their own provider_products.price
-- (app/(provider)/products.tsx). So the window is: accept at PHP 800 -> raise
-- the price -> the customer's screen still renders the stale PHP 800 -> the
-- customer taps -> the order commits at the NEW price and transitions straight
-- to in_transit. The customer is charged a price they never saw and never
-- agreed to.
--
-- THE FIX
-- -------
-- Snapshot the provider's per-item prices into the acceptance row at accept
-- time, and price the order from that snapshot — never from the live row.
--   1. order_acceptances gains quoted_prices (jsonb: product_id -> unit price)
--      and quoted_total (numeric: sum of price * quantity over the order's
--      items, EXCLUDING the express fee, which stays server-derived).
--   2. Backfill every existing row from today's live prices.
--   3. accept_order  — writes the snapshot (insert AND the re-accept do-update).
--   4. select_provider_for_order — prices from the snapshot.
--   5. The client (same commit) DISPLAYS quoted_total instead of recomputing.
--
-- SCOPE: the ONLY behavior change is that price is frozen at accept.
-- accept_order deliberately still accepts orders containing products the
-- provider has not priced or has marked unavailable — select_provider_for_order
-- catches that later, exactly as it does today. Availability is still checked
-- LIVE at selection (a provider genuinely going unavailable must still block
-- selection); only the PRICE comes from the snapshot.
--
-- ############################################################################
-- # SEQUENCING HAZARD — READ BEFORE APPLYING
-- #
-- # Migration 20240101000044_remove_stock_use_availability.sql is WRITTEN BUT
-- # NOT YET APPLIED. Its section 2 (lines 60-142) is stale: it creates
-- # select_provider_for_order with a 2-ARG signature (p_order_id, p_provider_id)
-- # that prices from the LIVE provider_products row, and grants it to
-- # authenticated.
-- #
-- # It does NOT overwrite the 4-arg function below — a different argument list
-- # makes `create or replace` an OVERLOAD, not a replace. That is worse than a
-- # revert: it leaves a granted 2-arg sibling that BYPASSES this fix (live
-- # pricing, so the TOCTOU is back) and additionally lacks 083's approval gate,
-- # the `for update` row lock, and the server-derived express fee. The app is
-- # unaffected — it passes all four named args, so PostgREST resolves to the
-- # 4-arg version — but the 2-arg form is callable directly by any
-- # authenticated user.
-- #
-- # Verified 2026-07-15 against the live DB: only the 4-arg form exists today,
-- # and 061 / 068 / 083 are all applied.
-- #
-- # Therefore: strip 044's section 2 (lines 60-142) before applying 044. It is
-- # stale regardless — 052/061/083 already removed the stock check it exists to
-- # remove. 044 is a separate, already-tracked decision and is NOT edited here.
-- ############################################################################


-- ----------------------------------------------------------------------------
-- 1. Columns
--
-- Nullable by design: a null snapshot is the "pre-migration, never backfilled"
-- state, which select_provider_for_order fails closed on. Section 2 makes that
-- unreachable for existing rows; accept_order makes it unreachable for new ones
-- (it always writes at least '{}'::jsonb).
-- ----------------------------------------------------------------------------

alter table public.order_acceptances
  add column if not exists quoted_total  numeric(12,2),
  add column if not exists quoted_prices jsonb;

comment on column public.order_acceptances.quoted_prices is
  'Snapshot of the provider''s per-product unit price (product_id -> price) at accept time. The order is priced from THIS, never from the live provider_products row.';
comment on column public.order_acceptances.quoted_total is
  'Sum of quoted_prices * quantity over the order''s items at accept time, EXCLUDING the express fee (which select_provider_for_order derives from platform_settings).';


-- ----------------------------------------------------------------------------
-- 2. Backfill every existing row (withdrawn or not)
--
-- From the CURRENT live provider_products prices for that acceptance's order
-- items — which is exactly what those in-flight orders would be charged right
-- now anyway, so this changes no outcome; it only stops the price from moving
-- from here on. In-flight orders must not break.
--
-- No is_available filter, deliberately: the client's bidding list did not
-- filter on it either, so the live price is what the customer is being shown.
-- Availability remains a LIVE check in select_provider_for_order.
--
-- Products the provider has no listing for are simply absent from the map —
-- select_provider_for_order then raises the same 'does not offer' error it
-- raises today. coalesce to '{}' means the snapshot is never null after this.
-- ----------------------------------------------------------------------------

update public.order_acceptances oa
  set quoted_prices = q.prices,
      quoted_total  = q.total
  from (
    select
      oa2.id,
      coalesce(jsonb_object_agg(x.product_id::text, x.price)
               filter (where x.product_id is not null), '{}'::jsonb) as prices,
      coalesce(sum(x.price * x.qty), 0)                              as total
    from public.order_acceptances oa2
    left join lateral (
      select oi.product_id, sum(oi.quantity) as qty, pp.price
      from public.order_items oi
      join public.provider_products pp
        on pp.provider_id = oa2.provider_id
       and pp.product_id  = oi.product_id
      where oi.order_id = oa2.order_id
        and pp.price is not null
      group by oi.product_id, pp.price
    ) x on true
    group by oa2.id
  ) q
  where oa.id = q.id;


-- ----------------------------------------------------------------------------
-- 3. accept_order: write the price snapshot
--
-- Verbatim from migration 083 section 1 — every guard byte-identical (the
-- FOR UPDATE lock on the order row, the auth check, the is_provider() check,
-- the is_approved approval gate, the status guard, the express/rider
-- restriction, the H1 balance gate with its profile row lock, the pending ->
-- awaiting_dealer_selection transition) — with ONE addition: the quoted_prices
-- / quoted_total snapshot, written on BOTH the insert and the ON CONFLICT
-- do-update path so that a withdraw + re-accept re-quotes cleanly at the
-- provider's current price.
--
-- Same 1-arg signature, so this is a true replace.
-- ----------------------------------------------------------------------------

create or replace function public.accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status        public.order_status;
  v_is_express    boolean;
  v_provider_type text;
  v_balance       numeric;
  v_min_balance   numeric;
  v_quoted_prices jsonb;
  v_quoted_total  numeric(12,2);
begin
  select status, is_express into v_status, v_is_express
    from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if not public.is_provider() then
    raise exception 'Not authorized';
  end if;
  -- Approval gate: is_provider() only checks the role, not is_approved. Without
  -- this, a provider whose account is pending (or has been un-approved) can
  -- still accept orders by calling the RPC directly.
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_approved = true
  ) then
    raise exception 'Your account is pending approval';
  end if;
  if v_status not in ('pending', 'awaiting_dealer_selection') then
    raise exception 'Order is not open for acceptance';
  end if;

  -- Express orders can only be accepted by riders.
  if v_is_express then
    select provider_type into v_provider_type
      from public.profiles where id = auth.uid();
    if v_provider_type is distinct from 'rider' then
      raise exception 'Express orders can only be accepted by riders';
    end if;
  end if;

  -- H1: server-side balance gate (mirrors the client check that was the only
  -- guard before). Lock the caller's profile row so the read is consistent.
  select balance into v_balance
    from public.profiles where id = auth.uid() for update;
  select min_balance into v_min_balance
    from public.platform_settings where id = 1;
  if v_balance < coalesce(v_min_balance, 0) then
    raise exception 'Insufficient balance to accept orders';
  end if;

  -- Price snapshot: this is the quote the customer will see and be charged.
  -- Grouped by product so duplicate order_items rows for the same product
  -- cannot collide on the jsonb key. Deliberately NOT a rejection gate —
  -- unpriced / unavailable products are simply absent from the map, and
  -- select_provider_for_order raises on them at selection time, exactly as
  -- today. coalesce to '{}' so the snapshot is never null.
  select
    coalesce(jsonb_object_agg(x.product_id::text, x.price), '{}'::jsonb),
    coalesce(sum(x.price * x.qty), 0)
  into v_quoted_prices, v_quoted_total
  from (
    select oi.product_id, sum(oi.quantity) as qty, pp.price
    from public.order_items oi
    join public.provider_products pp
      on pp.provider_id = auth.uid()
     and pp.product_id  = oi.product_id
    where oi.order_id = p_order_id
      and pp.price is not null
    group by oi.product_id, pp.price
  ) x;

  insert into public.order_acceptances (order_id, provider_id, quoted_prices, quoted_total)
    values (p_order_id, auth.uid(), v_quoted_prices, v_quoted_total)
    on conflict (order_id, provider_id)
    do update set withdrawn_at  = null,
                  accepted_at   = now(),
                  quoted_prices = excluded.quoted_prices,
                  quoted_total  = excluded.quoted_total;

  if v_status = 'pending' then
    update public.orders
      set status = 'awaiting_dealer_selection'
      where id = p_order_id and status = 'pending';
  end if;
end;
$$;

grant execute on function public.accept_order(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. select_provider_for_order: price from the snapshot, not the live row
--
-- Verbatim from migration 083 section 2 — every guard byte-identical (the
-- FOR UPDATE lock on the order row, the customer auth check, the status +
-- selected_provider_id guard, the acceptance check, the provider approval
-- check, the server-derived express fee (H3), the order_items reprice writing
-- unit_price / subtotal / provider_product_id, the in_transit transition) —
-- with ONE change: the per-item unit price now comes from the acceptance's
-- quoted_prices snapshot instead of a fresh read of provider_products.price.
--
-- What is deliberately still read LIVE:
--   * is_available — a provider who has genuinely gone unavailable must still
--     block selection. Only the PRICE is frozen.
--   * provider_product_id — the FK on order_items must point at the real row.
--
-- The price is null / price <= 0 guards now apply to the SNAPSHOT values, with
-- the same customer-facing messages (the app renders error.message raw).
--
-- Same 4-arg signature as 083 (the client passes all four named args), so this
-- is a true replace.
-- ----------------------------------------------------------------------------

create or replace function public.select_provider_for_order(
  p_order_id uuid,
  p_provider_id uuid,
  p_payment_method text default 'cash',
  p_is_express boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order         public.orders%rowtype;
  v_item          record;
  v_price         numeric(10,2);
  v_total         numeric(12,2) := 0;
  v_express_fee   numeric(10,2);
  v_quoted_prices jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.customer_id <> auth.uid() then
    raise exception 'Not authorized for this order';
  end if;

  if v_order.status <> 'awaiting_dealer_selection'
     or v_order.selected_provider_id is not null then
    raise exception 'Order is not open for provider selection';
  end if;

  -- Acceptance check, and the price quote that came with it. The quote is the
  -- binding artifact: it is what the customer was shown on the bidding list.
  select quoted_prices into v_quoted_prices
    from public.order_acceptances
    where order_id = p_order_id
      and provider_id = p_provider_id
      and withdrawn_at is null;

  if not found then
    raise exception 'Selected provider has not accepted this order';
  end if;

  -- Fail closed on a missing snapshot rather than silently falling back to the
  -- live price (which is the bug this migration exists to fix). Unreachable:
  -- section 2 backfilled every pre-existing row and accept_order always writes
  -- at least '{}'. Customer-facing wording — error.message is rendered raw.
  if v_quoted_prices is null then
    raise exception 'This provider''s quote is no longer valid. Please choose another.';
  end if;

  -- The selected provider must still be approved. Customer-facing wording: the
  -- app surfaces error.message directly.
  if not exists (
    select 1 from public.profiles
    where id = p_provider_id and is_approved = true
  ) then
    raise exception 'This provider is no longer available. Please choose another.';
  end if;

  -- Server-derived express fee (H3): trust the platform setting, not the client.
  v_express_fee := case
    when p_is_express then (select coalesce(express_delivery_fee, 0) from public.platform_settings where id = 1)
    else 0
  end;

  for v_item in
    select id, product_id, quantity from public.order_items
    where order_id = p_order_id
  loop
    -- Live existence + availability check (no stock check). The PRICE is NOT
    -- read here — a provider raising their price after accepting must not move
    -- this order's total.
    if not exists (
      select 1 from public.provider_products
      where provider_id = p_provider_id
        and product_id  = v_item.product_id
        and is_available = true
    ) then
      raise exception 'Selected provider does not offer one of the ordered products';
    end if;

    -- Price from the accept-time snapshot.
    v_price := (v_quoted_prices ->> v_item.product_id::text)::numeric(10,2);

    if v_price is null then
      raise exception 'Selected provider does not offer one of the ordered products';
    end if;
    if v_price <= 0 then
      raise exception 'Selected provider has not set a price for one of the ordered products';
    end if;

    update public.order_items
      set unit_price = v_price,
          subtotal   = v_price * v_item.quantity,
          provider_product_id = (
            select id from public.provider_products
            where provider_id = p_provider_id and product_id = v_item.product_id
          )
    where id = v_item.id;

    v_total := v_total + (v_price * v_item.quantity);
  end loop;

  update public.orders
    set selected_provider_id = p_provider_id,
        payment_method       = coalesce(p_payment_method, 'cash')::public.payment_method,
        is_express           = p_is_express,
        express_fee          = v_express_fee,
        total_amount         = v_total + v_express_fee,
        status               = 'in_transit'
  where id = p_order_id;
end;
$$;

grant execute on function public.select_provider_for_order(uuid, uuid, text, boolean) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Client read access — no grant change needed (verified, documented here)
--
-- Migration 080 revoked INSERT/UPDATE/DELETE on order_acceptances from anon /
-- authenticated but left the table-level SELECT grant in place, and there is no
-- column-level SELECT grant list on this table — so a table-level SELECT grant
-- covers new columns automatically. The initial schema's "order_acceptances:
-- customer read for own order" policy is intact (080 only replaced the provider
-- FOR ALL policy with a SELECT-only one). Customers can therefore read
-- quoted_total on their own order's acceptances with no further grant.
-- ----------------------------------------------------------------------------
