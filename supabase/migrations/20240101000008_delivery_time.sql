-- ============================================================
-- Migration: average delivery time tracking
-- ============================================================

-- ── 1. New columns ───────────────────────────────────────────

alter table public.orders
  add column if not exists delivery_started_at   timestamptz,
  add column if not exists delivery_completed_at timestamptz;

alter table public.profiles
  add column if not exists avg_delivery_minutes numeric;

-- ── 2. Helper function ───────────────────────────────────────

create or replace function public.calculate_provider_avg_delivery_time(provider_uuid uuid)
returns numeric
language sql
stable
as $$
  select round(avg(
    extract(epoch from (delivery_completed_at - delivery_started_at)) / 60
  )::numeric, 0)
  from public.orders
  where selected_provider_id = provider_uuid
    and status = 'delivered'
    and delivery_started_at is not null
    and delivery_completed_at is not null;
$$;

-- ── 3. Trigger function ──────────────────────────────────────

create or replace function public.handle_delivery_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Set delivery_started_at when status transitions to in_transit
  if NEW.status = 'in_transit' and OLD.status != 'in_transit' then
    NEW.delivery_started_at := now();
  end if;

  -- Update avg_delivery_minutes when order is delivered
  if NEW.status = 'delivered' and OLD.status != 'delivered' then
    if NEW.selected_provider_id is not null then
      update public.profiles
        set avg_delivery_minutes = public.calculate_provider_avg_delivery_time(NEW.selected_provider_id)
        where id = NEW.selected_provider_id;
    end if;
  end if;

  return NEW;
end;
$$;

-- ── 4. Trigger ───────────────────────────────────────────────

drop trigger if exists on_delivery_time_track on public.orders;

create trigger on_delivery_time_track
  before update on public.orders
  for each row
  execute function public.handle_delivery_time();
