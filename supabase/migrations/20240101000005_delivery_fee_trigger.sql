-- ============================================================
-- Migration: delivery fee trigger
-- Creates transactions table and auto-deducts admin_fee
-- from provider balance when order is delivered
-- ============================================================

-- ── 1. Transactions table ────────────────────────────────────

create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.profiles(id) on delete cascade,
  order_id     uuid references public.orders(id) on delete set null,
  type         text not null check (type in ('top_up', 'fee_deduction')),
  amount       numeric(10, 2) not null check (amount > 0),
  created_at   timestamptz not null default now()
);

alter table public.transactions enable row level security;

create policy "Providers can view own transactions"
  on public.transactions for select
  using (provider_id = auth.uid());

-- ── 2. Trigger function ──────────────────────────────────────

create or replace function public.handle_order_delivered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only fire when status transitions to 'delivered'
  if NEW.status = 'delivered' and OLD.status != 'delivered' then
    -- Only deduct if admin_fee > 0 and a provider was selected
    if NEW.admin_fee > 0 and NEW.selected_provider_id is not null then
      -- Deduct admin fee from provider balance
      update public.profiles
        set balance = balance - NEW.admin_fee
        where id = NEW.selected_provider_id;

      -- Record the transaction
      insert into public.transactions (provider_id, order_id, type, amount)
        values (NEW.selected_provider_id, NEW.id, 'fee_deduction', NEW.admin_fee);
    end if;
  end if;

  return NEW;
end;
$$;

-- ── 3. Trigger ───────────────────────────────────────────────

drop trigger if exists on_order_delivered on public.orders;

create trigger on_order_delivered
  after update on public.orders
  for each row
  execute function public.handle_order_delivered();
