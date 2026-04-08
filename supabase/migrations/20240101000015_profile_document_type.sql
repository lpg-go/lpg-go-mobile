ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS document_type text;
