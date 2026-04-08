ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS app_logo_url text;
