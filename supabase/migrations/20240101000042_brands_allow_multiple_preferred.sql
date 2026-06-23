-- Scope change: allow MULTIPLE preferred brands. Drop the single-preferred
-- constraint and the atomic switch function. The is_preferred column stays —
-- it's still the right model, now just a plain flag with no uniqueness.

drop index if exists brands_one_preferred;
drop function if exists public.set_preferred_brand(uuid);
