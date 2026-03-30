-- ============================================================
-- LPG Go — Initial Schema
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

create type public.user_role as enum ('customer', 'provider', 'admin');
create type public.provider_type as enum ('dealer', 'rider');
create type public.order_status as enum (
  'pending',
  'awaiting_dealer_selection',
  'in_transit',
  'awaiting_confirmation',
  'delivered',
  'cancelled'
);
create type public.payment_method as enum ('cash', 'card');
create type public.cancel_actor as enum ('customer', 'provider', 'system');
create type public.transaction_type as enum ('topup', 'fee_deduction');

-- ============================================================
-- TABLES
-- ============================================================

-- 1. profiles
create table public.profiles (
  id                uuid        primary key references auth.users(id) on delete cascade,
  role              public.user_role     not null default 'customer',
  provider_type     public.provider_type,
  full_name         text        not null,
  phone             text        not null unique,
  business_name     text,
  avatar_url        text,
  is_approved       boolean     not null default false,
  document_url      text,
  balance           numeric(10, 2) not null default 0,
  is_online         boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 2. brands
create table public.brands (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  logo_url   text,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);

-- 3. products
create table public.products (
  id         uuid        primary key default gen_random_uuid(),
  brand_id   uuid        not null references public.brands(id) on delete cascade,
  name       text        not null,
  size_kg    numeric     not null,
  admin_fee  numeric(10, 2) not null default 0,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);

-- 4. provider_products (note: table named provider_products, FK in order_items refs this)
create table public.provider_products (
  id           uuid    primary key default gen_random_uuid(),
  provider_id  uuid    not null references public.profiles(id) on delete cascade,
  product_id   uuid    not null references public.products(id) on delete cascade,
  price        numeric(10, 2) not null,
  stock        integer not null default 0,
  is_available boolean not null default true,
  unique (provider_id, product_id)
);

-- 5. orders
create table public.orders (
  id                   uuid                 primary key default gen_random_uuid(),
  customer_id          uuid                 not null references public.profiles(id) on delete restrict,
  selected_provider_id uuid                 references public.profiles(id) on delete set null,
  status               public.order_status  not null default 'pending',
  payment_method       public.payment_method not null,
  delivery_address     text                 not null,
  delivery_lat         numeric,
  delivery_lng         numeric,
  total_amount         numeric(10, 2)        not null,
  admin_fee            numeric(10, 2)        not null default 0,
  notes                text,
  expires_at           timestamptz,
  cancel_reason        text,
  cancelled_by         public.cancel_actor,
  created_at           timestamptz          not null default now(),
  updated_at           timestamptz          not null default now()
);

-- 6. order_items
create table public.order_items (
  id                  uuid          primary key default gen_random_uuid(),
  order_id            uuid          not null references public.orders(id) on delete cascade,
  product_id          uuid          not null references public.products(id) on delete restrict,
  provider_product_id uuid          not null references public.provider_products(id) on delete restrict,
  quantity            integer       not null check (quantity > 0),
  unit_price          numeric(10, 2) not null,
  subtotal            numeric(10, 2) not null
);

-- 7. order_acceptances
create table public.order_acceptances (
  id           uuid        primary key default gen_random_uuid(),
  order_id     uuid        not null references public.orders(id) on delete cascade,
  provider_id  uuid        not null references public.profiles(id) on delete cascade,
  accepted_at  timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique (order_id, provider_id)
);

-- 8. provider_locations
create table public.provider_locations (
  id          uuid        primary key default gen_random_uuid(),
  provider_id uuid        not null unique references public.profiles(id) on delete cascade,
  lat         numeric     not null,
  lng         numeric     not null,
  updated_at  timestamptz not null default now()
);

-- 9. messages
create table public.messages (
  id         uuid        primary key default gen_random_uuid(),
  order_id   uuid        not null references public.orders(id) on delete cascade,
  sender_id  uuid        not null references public.profiles(id) on delete cascade,
  content    text        not null,
  created_at timestamptz not null default now()
);

-- 10. transactions
create table public.transactions (
  id           uuid                    primary key default gen_random_uuid(),
  provider_id  uuid                    not null references public.profiles(id) on delete cascade,
  type         public.transaction_type not null,
  amount       numeric(10, 2)           not null,
  reference_id text,
  order_id     uuid                    references public.orders(id) on delete set null,
  created_at   timestamptz             not null default now()
);

-- 11. reviews
create table public.reviews (
  id          uuid        primary key default gen_random_uuid(),
  order_id    uuid        not null unique references public.orders(id) on delete cascade,
  customer_id uuid        not null references public.profiles(id) on delete cascade,
  provider_id uuid        not null references public.profiles(id) on delete cascade,
  rating      integer     not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now()
);

-- 12. platform_settings (single-row config)
create table public.platform_settings (
  id                        integer        primary key default 1,
  order_expiry_minutes      integer        not null default 10,
  min_balance               numeric(10, 2) not null default 0,
  min_stock_level           integer        not null default 0,
  require_provider_document boolean        not null default false,
  allow_cash_payment        boolean        not null default true,
  allow_card_payment        boolean        not null default true,
  updated_at                timestamptz    not null default now(),
  -- enforce single row
  constraint single_row check (id = 1)
);

insert into public.platform_settings default values;

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_products_brand_id              on public.products(brand_id);
create index idx_provider_products_provider_id  on public.provider_products(provider_id);
create index idx_provider_products_product_id   on public.provider_products(product_id);
create index idx_orders_customer_id             on public.orders(customer_id);
create index idx_orders_selected_provider_id    on public.orders(selected_provider_id);
create index idx_orders_status                  on public.orders(status);
create index idx_orders_created_at              on public.orders(created_at desc);
create index idx_order_items_order_id           on public.order_items(order_id);
create index idx_order_items_provider_product_id on public.order_items(provider_product_id);
create index idx_order_acceptances_order_id     on public.order_acceptances(order_id);
create index idx_order_acceptances_provider_id  on public.order_acceptances(provider_id);
create index idx_messages_order_id              on public.messages(order_id);
create index idx_transactions_provider_id       on public.transactions(provider_id);
create index idx_transactions_order_id          on public.transactions(order_id);
create index idx_reviews_customer_id            on public.reviews(customer_id);
create index idx_reviews_provider_id            on public.reviews(provider_id);

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger trg_platform_settings_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

create trigger trg_provider_locations_updated_at
  before update on public.provider_locations
  for each row execute function public.set_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'customer')
  );
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles           enable row level security;
alter table public.brands             enable row level security;
alter table public.products           enable row level security;
alter table public.provider_products  enable row level security;
alter table public.orders             enable row level security;
alter table public.order_items        enable row level security;
alter table public.order_acceptances  enable row level security;
alter table public.provider_locations enable row level security;
alter table public.messages           enable row level security;
alter table public.transactions       enable row level security;
alter table public.reviews            enable row level security;
alter table public.platform_settings  enable row level security;

-- Helper: is the caller an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Helper: is the caller a provider?
create or replace function public.is_provider()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'provider'
  );
$$;

-- ----------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------
create policy "profiles: users read own row"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles: users update own row"
  on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Admins can insert (e.g. creating provider accounts manually);
-- normal inserts happen via the trigger under security definer.
create policy "profiles: admin insert"
  on public.profiles for insert
  with check (public.is_admin());

create policy "profiles: admin delete"
  on public.profiles for delete
  using (public.is_admin());

-- Providers are visible to customers (name/phone/rating lookup)
create policy "profiles: customers read approved providers"
  on public.profiles for select
  using (
    (role = 'provider' and is_approved = true)
    or id = auth.uid()
    or public.is_admin()
  );

-- ----------------------------------------------------------------
-- brands
-- ----------------------------------------------------------------
create policy "brands: public read active"
  on public.brands for select
  using (is_active = true or public.is_admin());

create policy "brands: admin all"
  on public.brands for all
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------
-- products
-- ----------------------------------------------------------------
create policy "products: public read active"
  on public.products for select
  using (is_active = true or public.is_admin());

create policy "products: admin all"
  on public.products for all
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------
-- provider_products
-- ----------------------------------------------------------------
create policy "provider_products: public read available"
  on public.provider_products for select
  using (is_available = true or provider_id = auth.uid() or public.is_admin());

create policy "provider_products: provider manage own"
  on public.provider_products for all
  using (provider_id = auth.uid() or public.is_admin())
  with check (provider_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------
-- orders
-- ----------------------------------------------------------------
create policy "orders: customer read own"
  on public.orders for select
  using (
    customer_id = auth.uid()
    or selected_provider_id = auth.uid()
    or public.is_admin()
  );

create policy "orders: customer insert own"
  on public.orders for insert
  with check (customer_id = auth.uid() or public.is_admin());

create policy "orders: customer or provider update"
  on public.orders for update
  using (
    customer_id = auth.uid()
    or selected_provider_id = auth.uid()
    or public.is_admin()
  )
  with check (
    customer_id = auth.uid()
    or selected_provider_id = auth.uid()
    or public.is_admin()
  );

-- Providers can see pending/broadcast orders to accept them
create policy "orders: providers read pending broadcast"
  on public.orders for select
  using (
    (public.is_provider() and status in ('pending', 'awaiting_dealer_selection'))
    or customer_id = auth.uid()
    or selected_provider_id = auth.uid()
    or public.is_admin()
  );

-- ----------------------------------------------------------------
-- order_items
-- ----------------------------------------------------------------
create policy "order_items: parties read"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.customer_id = auth.uid() or o.selected_provider_id = auth.uid())
    )
    or public.is_admin()
  );

create policy "order_items: customer insert"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.customer_id = auth.uid()
    )
    or public.is_admin()
  );

-- ----------------------------------------------------------------
-- order_acceptances
-- ----------------------------------------------------------------
create policy "order_acceptances: provider manage own"
  on public.order_acceptances for all
  using (provider_id = auth.uid() or public.is_admin())
  with check (provider_id = auth.uid() or public.is_admin());

create policy "order_acceptances: customer read for own order"
  on public.order_acceptances for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.customer_id = auth.uid()
    )
    or public.is_admin()
  );

-- ----------------------------------------------------------------
-- provider_locations
-- ----------------------------------------------------------------
create policy "provider_locations: provider manage own"
  on public.provider_locations for all
  using (provider_id = auth.uid() or public.is_admin())
  with check (provider_id = auth.uid() or public.is_admin());

-- Customers tracking an active delivery can read the provider's location
create policy "provider_locations: customer read during delivery"
  on public.provider_locations for select
  using (
    exists (
      select 1 from public.orders o
      where o.selected_provider_id = provider_id
        and o.customer_id = auth.uid()
        and o.status = 'in_transit'
    )
    or public.is_admin()
  );

-- ----------------------------------------------------------------
-- messages
-- ----------------------------------------------------------------
create policy "messages: parties read"
  on public.messages for select
  using (
    sender_id = auth.uid()
    or exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.customer_id = auth.uid() or o.selected_provider_id = auth.uid())
    )
    or public.is_admin()
  );

create policy "messages: parties insert"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.customer_id = auth.uid() or o.selected_provider_id = auth.uid())
    )
  );

-- ----------------------------------------------------------------
-- transactions
-- ----------------------------------------------------------------
create policy "transactions: provider read own"
  on public.transactions for select
  using (provider_id = auth.uid() or public.is_admin());

create policy "transactions: admin all"
  on public.transactions for all
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------
-- reviews
-- ----------------------------------------------------------------
create policy "reviews: public read"
  on public.reviews for select
  using (true);

create policy "reviews: customer insert for own order"
  on public.reviews for insert
  with check (
    customer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.customer_id = auth.uid()
        and o.status = 'delivered'
    )
  );

create policy "reviews: admin all"
  on public.reviews for all
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------
-- platform_settings
-- ----------------------------------------------------------------
create policy "platform_settings: public read"
  on public.platform_settings for select
  using (true);

create policy "platform_settings: admin update"
  on public.platform_settings for update
  using (public.is_admin())
  with check (public.is_admin());
