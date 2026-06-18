-- Auto-approve new providers when the platform does not require a document.
--
-- When platform_settings.require_provider_document = false, a provider should be
-- able to enter the app and operate (go online / receive orders) without
-- uploading a DTI/SEC/license document. Operation is gated on profiles.is_approved
-- everywhere downstream (order fan-out, customer visibility, RLS, product
-- assignment), so "no document required" must mean "auto-approved".
--
-- Design: this is an AFTER INSERT trigger that performs an UPDATE setting
-- is_approved = true. That UPDATE then fires the EXISTING false->true assignment
-- trigger (trg_assign_products_on_approval, migration 20240101000016) naturally,
-- so provider_products are seeded through the one existing code path — we do NOT
-- duplicate the assignment logic here.
--
-- No recursion: this trigger fires only on INSERT, while the UPDATE it issues
-- only fires AFTER UPDATE triggers (the assignment trigger, which inserts into
-- provider_products and never updates profiles). AFTER INSERT issuing an UPDATE
-- on the just-inserted row is a safe pattern (unlike a BEFORE trigger mutating
-- the same command's row).
--
-- Fail-safe: if the platform_settings row/value is missing, doc_required is NULL,
-- `IS FALSE` is false, so we skip auto-approval and the provider keeps the strict
-- (document-required) path. The setting's column default also remains false-meaning
-- "not required" only when an admin deliberately sets it — the schema default is
-- already false, but routing + this trigger both fail safe toward requiring a doc.

create or replace function auto_approve_provider_when_doc_not_required()
returns trigger as $$
declare
  doc_required boolean;
begin
  if NEW.role = 'provider' and NEW.is_approved = false then
    select require_provider_document into doc_required
    from public.platform_settings
    where id = 1;

    -- Only auto-approve when the document requirement is explicitly off.
    -- NULL (missing settings) -> IS FALSE is false -> keep document-required path.
    if doc_required is false then
      update public.profiles
      set is_approved = true
      where id = NEW.id and is_approved = false;
      -- ^ fires trg_assign_products_on_approval (false->true) which seeds
      --   provider_products via the existing assignment path.
    end if;
  end if;

  return NEW; -- AFTER trigger: return value is ignored
end;
$$ language plpgsql security definer;

drop trigger if exists trg_auto_approve_provider on public.profiles;
create trigger trg_auto_approve_provider
after insert on public.profiles
for each row
execute function auto_approve_provider_when_doc_not_required();
