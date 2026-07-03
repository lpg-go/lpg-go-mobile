-- Express ETA schema
-- Adds ETA tracking to orders and admin-configurable ETA/express settings to platform_settings.

-- 1. orders: ETA tracking for express deliveries
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS eta_minutes integer,
  ADD COLUMN IF NOT EXISTS eta_deadline timestamptz;

COMMENT ON COLUMN public.orders.eta_minutes IS
  'Estimated delivery time in minutes for express orders (calculated at rider accept).';
COMMENT ON COLUMN public.orders.eta_deadline IS
  'The absolute timestamp by which delivery must be completed for the express fee to apply.';

-- 2. platform_settings: admin-configurable ETA and express fee split settings
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS eta_average_speed_kmh numeric(5,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS eta_mercy_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS express_platform_cut_percent numeric(5,2) NOT NULL DEFAULT 25;

COMMENT ON COLUMN public.platform_settings.eta_average_speed_kmh IS
  'Admin-configurable average rider speed (km/h) used for ETA calculation.';
COMMENT ON COLUMN public.platform_settings.eta_mercy_minutes IS
  'Buffer minutes added to the calculated ETA.';
COMMENT ON COLUMN public.platform_settings.express_platform_cut_percent IS
  'Platform''s share of the express fee as a percent (remainder goes to the rider).';
