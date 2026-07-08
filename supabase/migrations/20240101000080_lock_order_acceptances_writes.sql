-- H4 (security audit): order_acceptances had a permissive "provider manage own"
-- FOR ALL policy plus default table privileges, so a provider could INSERT an
-- acceptance row directly (supabase.from('order_acceptances').insert(...)),
-- bypassing accept_order's guards: the express-orders-only-riders restriction,
-- the pending/awaiting-dealer-selection state check, and (with migration 078)
-- the balance gate. All legitimate client access is SELECT-only; the only
-- writers are the SECURITY DEFINER RPCs accept_order and provider_withdraw,
-- which run as the function owner and are unaffected by the revoke/RLS below.

-- 1. Replace the FOR ALL (read+write) provider policy with SELECT-only.
drop policy if exists "order_acceptances: provider manage own" on public.order_acceptances;

create policy "order_acceptances: provider read own"
  on public.order_acceptances for select
  using (provider_id = auth.uid() or public.is_admin());

-- (The "order_acceptances: customer read for own order" SELECT policy from the
--  initial schema is left intact — customers still poll acceptances for their
--  own orders during the bidding phase.)

-- 2. Remove direct write privileges. Writes must go through accept_order /
--    provider_withdraw (SECURITY DEFINER, owner-privileged, RLS-exempt).
revoke insert, update, delete on public.order_acceptances from anon, authenticated;
