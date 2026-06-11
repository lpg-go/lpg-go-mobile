-- Configurable limit on how many active orders a customer can have at once.
-- 0 = unlimited (the mobile app treats 0 as "skip the check").
ALTER TABLE platform_settings
ADD COLUMN max_active_orders_per_customer integer NOT NULL DEFAULT 3;
