-- Preferred brand: admin can mark ONE brand as preferred so it floats to the
-- top of the customer brand list (above the alphabetical rest).

alter table public.brands
  add column is_preferred boolean not null default false;

-- At most one brand may be preferred at a time. A partial unique index only
-- indexes rows where is_preferred is true, so the many `false` rows are allowed.
create unique index brands_one_preferred
  on public.brands ((is_preferred))
  where is_preferred;

-- Atomically switch the preferred brand. Clearing the old preferred row and
-- setting the new one happen in the same transaction (a plpgsql function body
-- runs atomically), so the partial unique index is never violated mid-flight
-- and the table is never left with zero/two preferred brands on failure.
create or replace function public.set_preferred_brand(brand_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.brands set is_preferred = false where is_preferred;
  update public.brands set is_preferred = true where id = brand_id;
end;
$$;

-- Admin (signed-in) calls this via RPC.
grant execute on function public.set_preferred_brand(uuid) to authenticated;
