-- H1 (security audit): defense-in-depth — a provider balance must never go
-- negative. Adding a CHECK constraint validates all existing rows, so if any
-- profile already has a negative balance this migration ABORTS (transactionally,
-- changing nothing) with a descriptive message instead of a generic violation.
-- Resolve the offending rows first, then re-run.
--
-- To pre-check before running:
--   SELECT id, balance FROM public.profiles WHERE balance < 0;

do $$
declare
  v_neg integer;
begin
  select count(*) into v_neg from public.profiles where balance < 0;
  if v_neg > 0 then
    raise exception
      'Cannot add balance_nonneg: % profile row(s) have a negative balance. Resolve them first (SELECT id, balance FROM public.profiles WHERE balance < 0).',
      v_neg;
  end if;
end $$;

alter table public.profiles
  add constraint balance_nonneg check (balance >= 0);
