-- Stage 4: express delivery fee conditional logic.
--
-- Two rewrites:
--   1. mark_delivered — waive the express fee when the rider is LATE
--      (delivery_completed_at > eta_deadline), before the customer confirms.
--   2. handle_order_delivered — when the rider was ON TIME, deduct the
--      platform's cut of the express fee from the provider balance on delivery.
--
-- Requires migration 071 (express_platform_fee enum value) to be applied first.

-- ── PART 1: mark_delivered ──────────────────────────────────────────────────
-- Base definition from migration 060, extended with express late-fee waiver.

create or replace function public.mark_delivered(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider     uuid;
  v_status       public.order_status;
  v_is_express   boolean;
  v_eta_deadline timestamptz;
  v_express_fee  numeric(10,2);
  v_now          timestamptz;
  v_total        numeric(10,2);
begin
  select selected_provider_id, status, is_express, eta_deadline, express_fee, total_amount
    into v_provider, v_status, v_is_express, v_eta_deadline, v_express_fee, v_total
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

  -- Capture a single timestamp so the deadline comparison and the stored
  -- delivery_completed_at agree exactly.
  v_now := now();

  -- Rider is LATE: waive the express fee. Customer pays for goods only.
  if v_is_express and v_eta_deadline is not null and v_now > v_eta_deadline then
    -- Guard against underflow: only adjust if there is a fee to waive.
    if v_express_fee > 0 then
      update public.orders
        set express_fee  = 0,
            total_amount = v_total - v_express_fee
        where id = p_order_id;
    end if;
  end if;

  update public.orders
    set status = 'awaiting_confirmation',
        delivery_completed_at = v_now
    where id = p_order_id;
end;
$$;

grant execute on function public.mark_delivered(uuid) to authenticated;


-- ── PART 2: handle_order_delivered ──────────────────────────────────────────
-- Base definition from migration 050, extended with the on-time express
-- platform cut deduction.

create or replace function public.handle_order_delivered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cut         numeric;
  v_express_cut numeric;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then

    update public.orders
      set delivered_at = now()
      where id = new.id and delivered_at is null;

    if new.admin_fee > 0 and new.selected_provider_id is not null then
      update public.profiles
        set balance = balance - new.admin_fee
        where id = new.selected_provider_id;

      insert into public.transactions (provider_id, order_id, type, amount)
        values (new.selected_provider_id, new.id, 'fee_deduction', new.admin_fee);
    end if;

    -- Rider was ON TIME: platform takes its cut of the express fee.
    if new.is_express and new.eta_deadline is not null and new.delivery_completed_at <= new.eta_deadline then
      if new.express_fee > 0 and new.selected_provider_id is not null then
        select express_platform_cut_percent into v_cut
          from public.platform_settings where id = 1;
        v_express_cut := round(new.express_fee * coalesce(v_cut, 0) / 100, 2);
        if v_express_cut > 0 then
          update public.profiles
            set balance = balance - v_express_cut
            where id = new.selected_provider_id;
          insert into public.transactions (provider_id, order_id, type, amount)
            values (new.selected_provider_id, new.id, 'express_platform_fee', v_express_cut);
        end if;
      end if;
    end if;
    -- Note: if late, mark_delivered already set express_fee=0, so new.express_fee=0
    -- and the "express_fee > 0" guard makes this a no-op naturally.

  end if;
  return new;
end;
$$;
