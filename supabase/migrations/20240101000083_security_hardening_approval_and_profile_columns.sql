-- ============================================================================
-- Security hardening: approval gates, acceptance withdrawal, profile exposure.
--
-- is_approved was treated as a UI-only flag: is_provider() (initial_schema:281)
-- only checks role = 'provider', so an UNAPPROVED provider could still call
-- accept_order and appear in a customer's bidding list, and un-approving a
-- provider in the admin dashboard left their open acceptances live. This
-- migration makes approval load-bearing on the server, and trims two pieces of
-- over-exposure on profiles / provider_compliance_acceptances.
--
-- Six changes, nothing more:
--   1. accept_order            — reject unapproved providers.
--   2. select_provider_for_order — reject selection of an unapproved provider
--                                 (defense-in-depth) + add the missing row lock.
--   3. withdraw_provider_acceptances — new trigger: un-approving a provider
--                                 withdraws their open acceptances.
--   4. profiles SELECT policy   — providers can no longer read other providers;
--                                 expo_push_token revoked from client roles.
--   5. provider_compliance_acceptances — drop the client INSERT policy that let
--                                 a provider forge their own indemnity audit row.
--   6. Rotate the three seeded DEV test-account passwords.
--
-- is_provider() is deliberately NOT changed — it is used by RLS policies across
-- the schema where "is a provider at all" is the correct question. The approval
-- gate belongs in the RPCs that grant provider capability.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. accept_order: is_approved gate
--
-- Verbatim from migration 078, with ONE addition: the approval check directly
-- after the is_provider() check. Every other guard (FOR UPDATE lock on the order
-- row, status guard, express/rider restriction, H1 balance gate, the ON CONFLICT
-- re-accept path, the pending -> awaiting_dealer_selection transition) is
-- unchanged.
-- ----------------------------------------------------------------------------

create or replace function public.accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status        public.order_status;
  v_is_express    boolean;
  v_provider_type text;
  v_balance       numeric;
  v_min_balance   numeric;
begin
  select status, is_express into v_status, v_is_express
    from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if not public.is_provider() then
    raise exception 'Not authorized';
  end if;
  -- Approval gate: is_provider() only checks the role, not is_approved. Without
  -- this, a provider whose account is pending (or has been un-approved) can
  -- still accept orders by calling the RPC directly.
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_approved = true
  ) then
    raise exception 'Your account is pending approval';
  end if;
  if v_status not in ('pending', 'awaiting_dealer_selection') then
    raise exception 'Order is not open for acceptance';
  end if;

  -- Express orders can only be accepted by riders.
  if v_is_express then
    select provider_type into v_provider_type
      from public.profiles where id = auth.uid();
    if v_provider_type is distinct from 'rider' then
      raise exception 'Express orders can only be accepted by riders';
    end if;
  end if;

  -- H1: server-side balance gate (mirrors the client check that was the only
  -- guard before). Lock the caller's profile row so the read is consistent.
  select balance into v_balance
    from public.profiles where id = auth.uid() for update;
  select min_balance into v_min_balance
    from public.platform_settings where id = 1;
  if v_balance < coalesce(v_min_balance, 0) then
    raise exception 'Insufficient balance to accept orders';
  end if;

  insert into public.order_acceptances (order_id, provider_id)
    values (p_order_id, auth.uid())
    on conflict (order_id, provider_id)
    do update set withdrawn_at = null, accepted_at = now();

  if v_status = 'pending' then
    update public.orders
      set status = 'awaiting_dealer_selection'
      where id = p_order_id and status = 'pending';
  end if;
end;
$$;

grant execute on function public.accept_order(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 2. select_provider_for_order: is_approved gate + missing row lock
--
-- Verbatim from migration 061, with TWO additions:
--   a) `for update` on the order SELECT. Every sibling RPC (accept_order,
--      cancel_order, mark_delivered, …) locks the order row it is about to
--      transition; this one did not, so two concurrent selections could both
--      pass the "not open for provider selection" guard and race.
--   b) An approval check on the SELECTED provider (p_provider_id) — NOT
--      auth.uid(), the caller here is the customer. Change 1 already stops an
--      unapproved provider from accepting, and change 3 withdraws acceptances
--      on un-approval; this is the defense-in-depth backstop for an acceptance
--      that predates both. The message is customer-facing prose because the app
--      renders error.message raw to the user.
--
-- Every other guard (auth check, status + selected_provider_id guard, the
-- acceptance check, the server-derived express fee (H3), the per-item reprice
-- with its is_available / price>0 guards, the in_transit transition) is
-- unchanged. Same 4-arg signature as 061, so this is a true replace.
-- ----------------------------------------------------------------------------

create or replace function public.select_provider_for_order(
  p_order_id uuid,
  p_provider_id uuid,
  p_payment_method text default 'cash',
  p_is_express boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       public.orders%rowtype;
  v_item        record;
  v_price       numeric(10,2);
  v_total       numeric(12,2) := 0;
  v_express_fee numeric(10,2);
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.customer_id <> auth.uid() then
    raise exception 'Not authorized for this order';
  end if;

  if v_order.status <> 'awaiting_dealer_selection'
     or v_order.selected_provider_id is not null then
    raise exception 'Order is not open for provider selection';
  end if;

  if not exists (
    select 1 from public.order_acceptances
    where order_id = p_order_id
      and provider_id = p_provider_id
      and withdrawn_at is null
  ) then
    raise exception 'Selected provider has not accepted this order';
  end if;

  -- The selected provider must still be approved. Customer-facing wording: the
  -- app surfaces error.message directly.
  if not exists (
    select 1 from public.profiles
    where id = p_provider_id and is_approved = true
  ) then
    raise exception 'This provider is no longer available. Please choose another.';
  end if;

  -- Server-derived express fee (H3): trust the platform setting, not the client.
  v_express_fee := case
    when p_is_express then (select coalesce(express_delivery_fee, 0) from public.platform_settings where id = 1)
    else 0
  end;

  for v_item in
    select id, product_id, quantity from public.order_items
    where order_id = p_order_id
  loop
    -- Existence + price validation only (no stock check).
    select price into v_price
    from public.provider_products
    where provider_id = p_provider_id
      and product_id  = v_item.product_id
      and is_available = true;

    if v_price is null then
      raise exception 'Selected provider does not offer one of the ordered products';
    end if;
    if v_price <= 0 then
      raise exception 'Selected provider has not set a price for one of the ordered products';
    end if;

    update public.order_items
      set unit_price = v_price,
          subtotal   = v_price * v_item.quantity,
          provider_product_id = (
            select id from public.provider_products
            where provider_id = p_provider_id and product_id = v_item.product_id
          )
    where id = v_item.id;

    v_total := v_total + (v_price * v_item.quantity);
  end loop;

  update public.orders
    set selected_provider_id = p_provider_id,
        payment_method       = coalesce(p_payment_method, 'cash')::public.payment_method,
        is_express           = p_is_express,
        express_fee          = v_express_fee,
        total_amount         = v_total + v_express_fee,
        status               = 'in_transit'
  where id = p_order_id;
end;
$$;

grant execute on function public.select_provider_for_order(uuid, uuid, text, boolean) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. Withdraw open acceptances when a provider is un-approved
--
-- Un-approving a provider (admin dashboard) previously left their live
-- acceptances in place: the provider stayed in every customer's bidding list
-- and remained selectable. Withdraw them at the source.
--
-- Interaction with migration 037 (trg_reset_expiry_on_withdraw) — checked, and
-- the two cooperate correctly:
--   * 037 fires AFTER UPDATE on order_acceptances and acts only on the NULL ->
--     timestamp withdrawn_at transition, which is exactly what we write here.
--     So the affected orders correctly roll back onto the no-accept expiry
--     window, same as a manual provider_withdraw().
--   * No recursion: this trigger writes order_acceptances; 037 writes orders.
--     Neither writes profiles, so the cycle profiles -> order_acceptances ->
--     orders terminates. 037 also cannot re-enter itself (it does not touch
--     order_acceptances).
--   * No ordering hazard: 037 is an AFTER ... FOR EACH ROW trigger, so its
--     queued firings run once all rows of our single UPDATE are already written.
--     Its live_count therefore sees every one of this provider's rows as already
--     withdrawn and will not spuriously conclude a live acceptance remains. If
--     ANOTHER provider still has a live acceptance on the same order, live_count
--     is > 0 and 037 correctly leaves that order's expires_at alone.
--
-- is_approved is NOT NULL (initial_schema:36), so the WHEN clause below can
-- never evaluate to NULL and silently skip.
-- ----------------------------------------------------------------------------

create or replace function public.withdraw_provider_acceptances()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.order_acceptances
    set withdrawn_at = now()
    where provider_id = new.id
      and withdrawn_at is null;
  return new;
end;
$$;

drop trigger if exists withdraw_acceptances_on_unapprove on public.profiles;
create trigger withdraw_acceptances_on_unapprove
  after update of is_approved on public.profiles
  for each row
  when (old.is_approved and not new.is_approved and new.role = 'provider')
  execute function public.withdraw_provider_acceptances();


-- ----------------------------------------------------------------------------
-- 4. profiles SELECT policy: providers can no longer read other providers
--
-- The policy from initial_schema:317 exposed every approved provider's row to
-- ANY authenticated user — including rival providers, who could enumerate each
-- other's business_name / phone / rating. Customers still need the lookup; other
-- providers do not. Adding `and not public.is_provider()` keeps the customer
-- path and drops the provider-to-provider path, while `id = auth.uid()` keeps a
-- provider's own row readable and `public.is_admin()` keeps the admin dashboard
-- working.
-- ----------------------------------------------------------------------------

drop policy if exists "profiles: customers read approved providers" on public.profiles;
create policy "profiles: customers read approved providers"
  on public.profiles for select
  using (
    (role = 'provider' and is_approved = true and not public.is_provider())
    or id = auth.uid()
    or public.is_admin()
  );

-- expo_push_token has no client reader: lib/notifications.ts:81-84 writes it via
-- .update({ expo_push_token }) with no .select(), so no SELECT privilege is
-- needed for the write, and every read of it happens in the order-notifications
-- edge function under SERVICE_ROLE (which bypasses RLS and grants). Revoking it
-- from the client roles therefore has zero app impact. The column-level UPDATE
-- grant from migration 057 is deliberately left in place.
revoke select (expo_push_token) on public.profiles from authenticated, anon;

-- NOTE / follow-up: this revoke only bites once the TABLE-level SELECT grant on
-- public.profiles is gone. Supabase's default privileges grant table-level SELECT
-- to anon/authenticated, and a table-level grant overrides column-level revokes —
-- so as written this is a no-op belt on top of the RLS policy above (which is the
-- real fix), not a working column lock. Closing it properly needs the migration-057
-- pattern (REVOKE SELECT ON public.profiles, then GRANT SELECT on an explicit
-- column list) — deliberately NOT done here: it must be built from a live
-- \d public.profiles, because at least one column (expo_push_token, migration 056)
-- was added out-of-band and this migration history is not a complete schema
-- snapshot. An incomplete column list would silently break reads in production.
--
-- ALSO out of scope, deliberately: balance, document_url and phone stay readable.
-- Each has live client readers, so locking them down needs app changes shipped in
-- the same batch. Not this migration.


-- ----------------------------------------------------------------------------
-- 5. Drop the client INSERT policy on provider_compliance_acceptances
--
-- Migration 053 gave providers `WITH CHECK (provider_id = auth.uid())` on
-- INSERT, but the real acceptance row is written server-side by the signup
-- trigger (migration 054:47-49) under security definer. The client policy
-- therefore grants nothing legitimate and lets a provider hand-write their own
-- indemnity audit row — forging the version/undertaking_text snapshot on an
-- append-only legal audit trail. The provider read + admin policies stay.
-- ----------------------------------------------------------------------------

drop policy if exists "compliance: provider insert own"
  on public.provider_compliance_acceptances;


-- ----------------------------------------------------------------------------
-- 6. Rotate the seeded test-account passwords
--
-- Migration 004 seeded three accounts with the well-known bcrypt hash of the
-- literal string 'password' — the canonical $2a$10$92IXUNpkjO0... hash that
-- appears in every Supabase tutorial. Anyone who has read this repo (or guessed)
-- could sign in as Test Dealer and accept live orders. The accounts are KEPT —
-- they are the project's dev test logins — and moved to a shared password.
--
-- New password (all three): hmhGardrIbegcndSq6ya
--
-- Stated in plaintext here by explicit choice: these are DEV-ONLY accounts on a
-- non-production database and the password is committed to the repo deliberately,
-- so the team can find it. If this database is ever exposed to the internet — or
-- these accounts are ever created on production — rotate this password and delete
-- the accounts.
--
-- crypt()/gen_salt() come from pgcrypto, which Supabase pre-installs into the
-- `extensions` schema (see supabase/config.toml: extra_search_path = ["public",
-- "extensions"]). No migration in this project has called them before, and this
-- script runs with a bare search_path in the SQL Editor, so both are
-- schema-qualified rather than relying on the session search_path.
-- ----------------------------------------------------------------------------

update auth.users
  set encrypted_password = extensions.crypt('hmhGardrIbegcndSq6ya', extensions.gen_salt('bf'))
  where email in (
    '630000000000@lpggo.app',
    '631111111111@lpggo.app',
    '632222222222@lpggo.app'
  );
