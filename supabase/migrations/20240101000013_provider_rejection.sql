ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rejection_reason text;
