-- ============================================================
-- Migration: auto-assign all active products to providers
-- ============================================================

-- ── 1. Helper function ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_all_products_to_provider(provider_uuid uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO public.provider_products (provider_id, product_id, price, stock)
  SELECT provider_uuid, p.id, 0.00, 0
  FROM public.products p
  WHERE p.is_active = true
  ON CONFLICT (provider_id, product_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. Back-fill existing providers ─────────────────────────

SELECT public.assign_all_products_to_provider(id)
FROM public.profiles
WHERE role = 'provider';

-- ── 3. Updated handle_new_user trigger ──────────────────────
-- Calls assign_all_products_to_provider when a new provider registers

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_role public.user_role;
BEGIN
  new_role := COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'customer');

  INSERT INTO public.profiles (id, full_name, phone, role, provider_type, business_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, ''),
    new_role,
    CASE
      WHEN NEW.raw_user_meta_data->>'provider_type' IS NOT NULL
      THEN (NEW.raw_user_meta_data->>'provider_type')::public.provider_type
      ELSE NULL
    END,
    NEW.raw_user_meta_data->>'business_name'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name      = EXCLUDED.full_name,
    phone          = EXCLUDED.phone,
    role           = EXCLUDED.role,
    provider_type  = EXCLUDED.provider_type,
    business_name  = EXCLUDED.business_name,
    updated_at     = NOW();

  -- Auto-assign all active products when a provider registers
  IF new_role = 'provider' THEN
    PERFORM public.assign_all_products_to_provider(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;
