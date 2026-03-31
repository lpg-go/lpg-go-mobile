-- ============================================================
-- Add otp_enabled to platform_settings
-- ============================================================

alter table public.platform_settings
  add column otp_enabled boolean not null default false;

-- ============================================================
-- Update handle_new_user to handle all profile fields
-- and use upsert so code-side upserts don't conflict
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role, provider_type, business_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', new.phone, ''),
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'customer'),
    case
      when new.raw_user_meta_data->>'provider_type' is not null
      then (new.raw_user_meta_data->>'provider_type')::public.provider_type
      else null
    end,
    new.raw_user_meta_data->>'business_name'
  )
  on conflict (id) do update set
    full_name      = excluded.full_name,
    phone          = excluded.phone,
    role           = excluded.role,
    provider_type  = excluded.provider_type,
    business_name  = excluded.business_name,
    updated_at     = now();
  return new;
end;
$$;
