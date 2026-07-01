-- ============================================================================
-- H5 fix: server-side order status-transition RPCs.
--
-- Until now the client wrote orders.status directly (confirm delivery, mark
-- delivered, cancel, provider withdraw, accept). RLS only checked ownership,
-- never the from-state, so a customer could jump straight to 'delivered' from
-- any state and fire the on_order_delivered fee deduction out of sequence.
--
-- These SECURITY DEFINER RPCs own each transition: they load the order FOR
-- UPDATE, assert the actor (customer owner / assigned provider / any provider),
-- assert the valid from-state, then perform the update. The client calls the
-- RPC instead of an UPDATE. Mirrors the place_order (058) style.
--
-- NOTE: this migration does NOT yet revoke the client's UPDATE (status, ...)
-- grant from migration 059 — that grant tightening is a separate step, done
-- once every status-writing client path has been switched to these RPCs.
--
-- The on_order_delivered trigger (050) still owns delivered_at + the admin-fee
-- deduction; confirm_delivery only flips status and lets the trigger fire.
-- ============================================================================

-- ── 1. confirm_delivery — customer confirms receipt ─────────────────────────
-- awaiting_confirmation -> delivered. Replaces order/[id].tsx:603.
create or replace function public.confirm_delivery(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
  v_status   public.order_status;
begin
  select customer_id, status into v_customer, v_status
    from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if v_customer is distinct from auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_status <> 'awaiting_confirmation' then
    raise exception 'Order is not awaiting confirmation';
  end if;

  -- Flip status only. The on_order_delivered trigger stamps delivered_at and
  -- deducts the admin fee — DO NOT touch those here.
  update public.orders set status = 'delivered' where id = p_order_id;
end;
$$;

grant execute on function public.confirm_delivery(uuid) to authenticated;

-- ── 2. mark_delivered — assigned provider marks the order delivered ─────────
-- in_transit -> awaiting_confirmation, stamps delivery_completed_at.
-- Replaces (provider)/active/[id].tsx:370. (The pre-delivery safety-check row
-- is still inserted client-side beforehand — it has its own RLS and is not a
-- status write.)
create or replace function public.mark_delivered(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
  v_status   public.order_status;
begin
  select selected_provider_id, status into v_provider, v_status
    from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if v_provider is distinct from auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_status <> 'in_transit' then
    raise exception 'Order is not in transit';
  end if;

  update public.orders
    set status = 'awaiting_confirmation',
        delivery_completed_at = now()
    where id = p_order_id;
end;
$$;

grant execute on function public.mark_delivered(uuid) to authenticated;

-- ── 3. cancel_order — customer cancels ──────────────────────────────────────
-- pending / awaiting_dealer_selection / in_transit -> cancelled.
-- NOT allowed from awaiting_confirmation or delivered (can't cancel after the
-- rider marked delivered). Replaces find-store:515 + order/[id].tsx:570.
create or replace function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
  v_status   public.order_status;
begin
  select customer_id, status into v_customer, v_status
    from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if v_customer is distinct from auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_status not in ('pending', 'awaiting_dealer_selection', 'in_transit') then
    raise exception 'Order cannot be cancelled at this stage';
  end if;

  -- cancelled_by is public.cancel_actor enum; 'customer' matches the client.
  update public.orders
    set status = 'cancelled',
        cancelled_by = 'customer'
    where id = p_order_id;
end;
$$;

grant execute on function public.cancel_order(uuid) to authenticated;

-- ── 4. provider_withdraw — assigned provider drops the order ────────────────
-- in_transit -> awaiting_dealer_selection, clears selected_provider_id.
-- Replaces (provider)/active/[id].tsx:404. Also stamps the provider's own
-- acceptance withdrawn_at (mirrors the client's second write at :420 and drives
-- the reset_expiry_on_withdraw trigger, migration 037).
create or replace function public.provider_withdraw(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
  v_status   public.order_status;
begin
  select selected_provider_id, status into v_provider, v_status
    from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if v_provider is distinct from auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_status <> 'in_transit' then
    raise exception 'Cannot withdraw at this stage';
  end if;

  update public.orders
    set status = 'awaiting_dealer_selection',
        selected_provider_id = null
    where id = p_order_id;

  update public.order_acceptances
    set withdrawn_at = now()
    where order_id = p_order_id
      and provider_id = auth.uid()
      and withdrawn_at is null;
end;
$$;

grant execute on function public.provider_withdraw(uuid) to authenticated;

-- ── 5. accept_order — a provider accepts a broadcast order ──────────────────
-- Provider accept DOES write orders.status: it inserts an order_acceptances row
-- and then bumps pending -> awaiting_dealer_selection (the guarded UPDATE at
-- (provider)/index.tsx:417-421). Because that status bump is a client status
-- write, it is folded into this RPC so the status grant can be revoked later.
--
-- The acceptance insert uses ON CONFLICT to reactivate a previously-withdrawn
-- acceptance (unique(order_id, provider_id) would otherwise reject a re-accept
-- and surface an error — this is a deliberate robustness improvement over the
-- plain client insert).
create or replace function public.accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.order_status;
begin
  select status into v_status
    from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if not public.is_provider() then
    raise exception 'Not authorized';
  end if;
  if v_status not in ('pending', 'awaiting_dealer_selection') then
    raise exception 'Order is not open for acceptance';
  end if;

  insert into public.order_acceptances (order_id, provider_id)
    values (p_order_id, auth.uid())
    on conflict (order_id, provider_id)
    do update set withdrawn_at = null, accepted_at = now();

  -- Only the first acceptance advances a still-pending order.
  if v_status = 'pending' then
    update public.orders
      set status = 'awaiting_dealer_selection'
      where id = p_order_id and status = 'pending';
  end if;
end;
$$;

grant execute on function public.accept_order(uuid) to authenticated;
