-- ============================================================================
-- Display ID system (Phase C — Item #4)
-- ============================================================================
-- Gives every profile a human-readable identifier in the format:
--   LG{PREFIX}{5-digit-zero-padded}
--     Customer -> LGCS00001
--     Dealer   -> LGDL00001
--     Rider    -> LGRD00001
--     Admin    -> LGAD00001
--
-- Each role (and provider sub-type) has its OWN sequence starting at 1, so the
-- numbers are independent per category. New rows get an ID automatically via
-- triggers; existing rows are backfilled in created_at order.
--
-- This is the first use of Postgres sequences in this codebase — there was no
-- prior human-readable ID / reference-number pattern to align with.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Sequences — one per category. These drive the numeric suffix.
-- ----------------------------------------------------------------------------
create sequence if not exists public.seq_display_id_customer;
create sequence if not exists public.seq_display_id_dealer;
create sequence if not exists public.seq_display_id_rider;
create sequence if not exists public.seq_display_id_admin;

-- ----------------------------------------------------------------------------
-- 2. Column — nullable + unique. Nullable so provider rows mid-signup (no
--    provider_type yet) can exist without an ID until their type is chosen.
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists display_id text unique;

-- ----------------------------------------------------------------------------
-- 3. Helper function — maps a (role, provider_type) pair to the next ID by
--    pulling from the matching sequence. Returns NULL for provider rows that
--    don't yet have a provider_type (incomplete signup) so we don't burn a
--    sequence value or assign a meaningless ID.
-- ----------------------------------------------------------------------------
create or replace function public.generate_display_id(
  p_role user_role,
  p_provider_type provider_type
) returns text
language plpgsql
as $$
declare
  v_prefix text;
  v_num bigint;
begin
  if p_role = 'customer' then
    v_prefix := 'CS';
    v_num := nextval('seq_display_id_customer');
  elsif p_role = 'provider' and p_provider_type = 'dealer' then
    v_prefix := 'DL';
    v_num := nextval('seq_display_id_dealer');
  elsif p_role = 'provider' and p_provider_type = 'rider' then
    v_prefix := 'RD';
    v_num := nextval('seq_display_id_rider');
  elsif p_role = 'admin' then
    v_prefix := 'AD';
    v_num := nextval('seq_display_id_admin');
  else
    return null;  -- provider rows with null provider_type (mid-signup) get no ID yet
  end if;
  return 'LG' || v_prefix || lpad(v_num::text, 5, '0');
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Backfill — assign IDs to all existing rows, numbered per category in
--    created_at order (oldest = 00001). Provider rows with a null
--    provider_type are skipped; they'll get an ID via the update trigger once
--    their type is set.
-- ----------------------------------------------------------------------------
with ranked as (
  select id, role, provider_type,
         row_number() over (
           partition by
             case
               when role = 'customer' then 'customer'
               when role = 'provider' and provider_type = 'dealer' then 'dealer'
               when role = 'provider' and provider_type = 'rider' then 'rider'
               when role = 'admin' then 'admin'
               else 'skip'
             end
           order by created_at
         ) as rn
  from public.profiles
)
update public.profiles p
set display_id = case
  when r.role = 'customer'                                then 'LGCS' || lpad(r.rn::text, 5, '0')
  when r.role = 'provider' and r.provider_type = 'dealer' then 'LGDL' || lpad(r.rn::text, 5, '0')
  when r.role = 'provider' and r.provider_type = 'rider'  then 'LGRD' || lpad(r.rn::text, 5, '0')
  when r.role = 'admin'                                   then 'LGAD' || lpad(r.rn::text, 5, '0')
  else null
end
from ranked r
where r.id = p.id
  and not (r.role = 'provider' and r.provider_type is null);

-- ----------------------------------------------------------------------------
-- 5. Advance sequences — set each sequence to the highest backfilled number so
--    the NEXT nextval() returns max+1. is_called=true means the given value is
--    treated as already-used. coalesce(..., 0) handles the empty-category case
--    so nextval() correctly starts at 1.
--    substring(display_id from 5) strips the 4-char "LGCS" prefix, leaving the
--    numeric suffix.
-- ----------------------------------------------------------------------------
select setval('seq_display_id_customer', coalesce(
  (select max(substring(display_id from 5)::int)
   from public.profiles where display_id like 'LGCS%'), 0), true);

select setval('seq_display_id_dealer', coalesce(
  (select max(substring(display_id from 5)::int)
   from public.profiles where display_id like 'LGDL%'), 0), true);

select setval('seq_display_id_rider', coalesce(
  (select max(substring(display_id from 5)::int)
   from public.profiles where display_id like 'LGRD%'), 0), true);

select setval('seq_display_id_admin', coalesce(
  (select max(substring(display_id from 5)::int)
   from public.profiles where display_id like 'LGAD%'), 0), true);

-- ----------------------------------------------------------------------------
-- 6. Triggers — auto-assign IDs to new/updated rows.
--    Uses security definer so the assignment works regardless of the caller's
--    RLS context. The trigger updates the same row after insert/update; the
--    null-display_id guard plus the WHEN clause on the update trigger prevent
--    re-entrant loops.
-- ----------------------------------------------------------------------------
create or replace function public.assign_display_id_trigger()
returns trigger as $$
begin
  -- Fire only if no display_id yet AND row is in a state that qualifies
  if NEW.display_id is null and (
    NEW.role = 'customer' or
    NEW.role = 'admin' or
    (NEW.role = 'provider' and NEW.provider_type is not null)
  ) then
    update public.profiles
    set display_id = public.generate_display_id(NEW.role, NEW.provider_type)
    where id = NEW.id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- On insert: covers customers, admins, and providers who already have a type.
drop trigger if exists trg_assign_display_id_on_insert on public.profiles;
create trigger trg_assign_display_id_on_insert
  after insert on public.profiles
  for each row execute function assign_display_id_trigger();

-- On update: covers the provider mid-signup case — fires only when
-- provider_type transitions from null to a real value, so an ID is assigned
-- exactly once at that moment.
drop trigger if exists trg_assign_display_id_on_update on public.profiles;
create trigger trg_assign_display_id_on_update
  after update of provider_type on public.profiles
  for each row
  when (OLD.provider_type is null and NEW.provider_type is not null)
  execute function assign_display_id_trigger();
