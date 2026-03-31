-- ============================================================
-- Seed: test customer user (local dev / staging only)
-- ============================================================
-- Password: password (bcrypt hash below)
-- Login email (phone-as-email): 639171234567@lpggo.app
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
  'b0000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  '639171234567@lpggo.app',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Test Customer", "phone": "+639171234567", "role": "customer"}',
  false,
  false,
  now(),
  now()
) on conflict (id) do nothing;

-- ============================================================
-- 2. profiles
-- Upsert after trigger to ensure all fields are correct
-- ============================================================

insert into public.profiles (
  id,
  role,
  full_name,
  phone,
  is_approved,
  created_at,
  updated_at
) values (
  'b0000000-0000-0000-0000-000000000001',
  'customer',
  'Test Customer',
  '+639171234567',
  true,
  now(),
  now()
) on conflict (id) do nothing;
