
-- ============================================================
-- Seed: test provider user (local dev / staging only)
-- ============================================================
-- Password: testpassword123
-- Login email (phone-as-email): 639009999999@lpggo.app
-- ============================================================

-- ============================================================
-- 1. auth.users
-- ============================================================

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
) values (
  'a0000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  '639009999999@lpggo.app',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Test Dealer", "phone": "+639009999999", "role": "provider", "provider_type": "dealer", "business_name": "Test LPG Store"}',
  false,
  false,
  now(),
  now()
) on conflict (id) do nothing;

-- ============================================================
-- 2. profiles
-- The handle_new_user trigger fires on the auth.users insert
-- and creates the base profile. We upsert here to ensure all
-- operational fields (is_approved, balance, is_online) are set.
-- ============================================================

insert into public.profiles (
  id,
  role,
  provider_type,
  full_name,
  phone,
  business_name,
  is_approved,
  balance,
  is_online,
  created_at,
  updated_at
) values (
  'a0000000-0000-0000-0000-000000000001',
  'provider',
  'dealer',
  'Test Dealer',
  '+639009999999',
  'Test LPG Store',
  true,
  500.00,
  true,
  now(),
  now()
) on conflict (id) do update set
  role          = excluded.role,
  provider_type = excluded.provider_type,
  full_name     = excluded.full_name,
  phone         = excluded.phone,
  business_name = excluded.business_name,
  is_approved   = excluded.is_approved,
  balance       = excluded.balance,
  is_online     = excluded.is_online,
  updated_at    = now();

-- ============================================================
-- 3. provider_products
-- 20 products across 5 brands × 4 sizes
-- Prices: 2.7kg=180, 5kg=320, 11kg=680, 22kg=1350
-- ============================================================

insert into public.provider_products
  (provider_id, product_id, price, stock, is_available)
values
  -- Petron Gasul
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0001-000000000001',  180.00, 20, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0001-000000000002',  320.00, 15, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0001-000000000003',  680.00, 10, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0001-000000000004', 1350.00,  5, true),
  -- Shellane
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0002-000000000001',  180.00, 20, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0002-000000000002',  320.00, 15, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0002-000000000003',  680.00, 10, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0002-000000000004', 1350.00,  5, true),
  -- Solane
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0003-000000000001',  180.00, 20, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0003-000000000002',  320.00, 15, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0003-000000000003',  680.00, 10, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0003-000000000004', 1350.00,  5, true),
  -- Total
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0004-000000000001',  180.00, 20, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0004-000000000002',  320.00, 15, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0004-000000000003',  680.00, 10, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0004-000000000004', 1350.00,  5, true),
  -- Caltex
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0005-000000000001',  180.00, 20, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0005-000000000002',  320.00, 15, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0005-000000000003',  680.00, 10, true),
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0005-000000000004', 1350.00,  5, true)
on conflict (provider_id, product_id) do nothing;
