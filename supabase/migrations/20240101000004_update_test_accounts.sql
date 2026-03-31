-- ============================================================
-- Update test accounts (local dev / staging only)
-- Replaces previous test users with new phone numbers
-- ============================================================
-- Passwords: all use hash for 'password'
-- Customer:  630000000000@lpggo.app
-- Dealer:    631111111111@lpggo.app
-- Rider:     632222222222@lpggo.app
-- ============================================================

-- ============================================================
-- 1. Clean up test order data (avoids FK constraint errors)
-- ============================================================

delete from public.order_items where order_id in (
  select id from public.orders where customer_id = 'b0000000-0000-0000-0000-000000000001'
);
delete from public.order_acceptances where order_id in (
  select id from public.orders where customer_id = 'b0000000-0000-0000-0000-000000000001'
);
delete from public.orders where customer_id = 'b0000000-0000-0000-0000-000000000001';

-- ============================================================
-- 2. Remove old test accounts
-- ============================================================

delete from auth.users
  where email in ('639171234567@lpggo.app', '639009999999@lpggo.app');

delete from public.profiles
  where phone in ('+639171234567', '+639009999999');

-- ============================================================
-- 2. Test customer
-- ============================================================

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous, created_at, updated_at
) values (
  'b0000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  '630000000000@lpggo.app',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Test Customer", "phone": "+630000000000", "role": "customer"}',
  false, false, now(), now()
) on conflict (id) do nothing;

insert into public.profiles (
  id, role, full_name, phone, is_approved, created_at, updated_at
) values (
  'b0000000-0000-0000-0000-000000000001',
  'customer',
  'Test Customer',
  '+630000000000',
  true,
  now(), now()
) on conflict (id) do nothing;

-- ============================================================
-- 3. Test dealer (provider)
-- ============================================================

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous, created_at, updated_at
) values (
  'a0000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  '631111111111@lpggo.app',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Test Dealer", "phone": "+631111111111", "role": "provider", "provider_type": "dealer", "business_name": "Test LPG Store"}',
  false, false, now(), now()
) on conflict (id) do nothing;

insert into public.profiles (
  id, role, provider_type, full_name, phone, business_name,
  is_approved, balance, is_online, created_at, updated_at
) values (
  'a0000000-0000-0000-0000-000000000001',
  'provider',
  'dealer',
  'Test Dealer',
  '+631111111111',
  'Test LPG Store',
  true, 500.00, true,
  now(), now()
) on conflict (id) do nothing;

-- ============================================================
-- 4. Test rider (provider)
-- ============================================================

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous, created_at, updated_at
) values (
  'c0000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  '632222222222@lpggo.app',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Test Rider", "phone": "+632222222222", "role": "provider", "provider_type": "rider"}',
  false, false, now(), now()
) on conflict (id) do nothing;

insert into public.profiles (
  id, role, provider_type, full_name, phone,
  is_approved, balance, is_online, created_at, updated_at
) values (
  'c0000000-0000-0000-0000-000000000001',
  'provider',
  'rider',
  'Test Rider',
  '+632222222222',
  true, 500.00, true,
  now(), now()
) on conflict (id) do nothing;

-- ============================================================
-- 5. provider_products — dealer UUID unchanged, no-op
-- ============================================================
-- provider_products already references a0000000-0000-0000-0000-000000000001
-- from migration 20240101000002. No update needed.
