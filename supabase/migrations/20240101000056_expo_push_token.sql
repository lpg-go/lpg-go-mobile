-- Back-fills the expo_push_token column that was added out-of-band to the live
-- dev DB but never captured in a migration (schema drift). Needed for prod parity.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expo_push_token text;
