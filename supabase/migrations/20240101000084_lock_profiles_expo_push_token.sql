-- ============================================================================
-- Make profiles.expo_push_token unreadable by the client roles.
--
-- This is the follow-up that migration 083 explicitly deferred (see its NOTE at
-- the end of section 4). 083 wrote:
--
--     revoke select (expo_push_token) on public.profiles from authenticated, anon;
--
-- which is a NO-OP: Supabase's default privileges grant TABLE-level SELECT on
-- public tables to anon/authenticated, and in Postgres a table-level grant
-- overrides a column-level revoke. The only way to lock a column is to drop the
-- table-level grant and re-grant SELECT on an explicit column list — exactly the
-- pattern migration 057 already uses on this same table for UPDATE.
--
-- ONE change, nothing more.
--
-- WHY the token must not be client-readable
--   Expo's push API (https://exp.host/--/api/v2/push/send) accepts ANY token
--   with NO authentication — possession of the token is the whole credential.
--   The policy "profiles: customers read approved providers" (as amended by 083)
--   still lets any customer read every approved provider's row, and so does any
--   ANON caller: is_provider() is false for anon, so the policy's first branch
--   (role = 'provider' and is_approved and not is_provider()) evaluates true.
--   That makes every approved provider's push token harvestable, which lets an
--   attacker send arbitrary notifications to every provider's device — a
--   ready-made phishing vector. RLS cannot help here: the row is legitimately
--   visible, it is the COLUMN that must not be.
--
-- WHY anon is included
--   The anon key ships inside the app bundle, so it is public by construction,
--   and the policy branch above is true for anon.
--
-- WHY this has zero app impact
--   * The only client touch of the column is a WRITE: lib/notifications.ts:82-84
--         .from('profiles')
--         .update({ expo_push_token: token })
--         .eq('id', user.id);
--     There is no .select() chained onto it, so PostgREST sends
--     `Prefer: return=minimal` and never reads the column back — no SELECT
--     privilege is required. The column-level UPDATE grant from migration 057
--     (which includes expo_push_token) is deliberately left intact, so the write
--     path is unchanged.
--   * Every READ of the token happens in the order-notifications edge function
--     (supabase/functions/order-notifications/index.ts) under SERVICE_ROLE,
--     which bypasses both grants and RLS.
--   * Verified: no client file selects expo_push_token, there is no `select('*')`
--     or bare `.select()` anywhere in app/ components/ lib/, and no
--     supabase.channel() subscribes to postgres_changes on `profiles` (Realtime
--     respects column privileges, so a subscription would have silently dropped
--     the column from its payload).
--
-- WHY balance / document_url / phone REMAIN in the grant list
--   Each still has live client readers, so restricting them requires app changes
--   shipped in the same batch — explicitly out of scope here, same call 083 made:
--     * balance      — app/(provider)/index.tsx, topup.tsx, earnings.tsx (own row)
--     * document_url — app/_layout.tsx, app/(auth)/upload-document.tsx (own row)
--     * phone        — app/(provider)/active/[id].tsx:446 and
--                      app/(customer)/order/[id].tsx:648 (tel: buttons, cross-user)
--   Follow-up, not this migration.
--
-- Note on scope: RLS still decides WHICH ROWS a caller sees. This is column-level
-- defense layered on top of that, not a replacement for it.
--
-- The column list below is the LIVE public.profiles column set (from
-- information_schema, in ordinal order), which is authoritative — the migration
-- history is not a complete schema snapshot (expo_push_token was added
-- out-of-band; see migration 056). 21 live columns, 20 granted, expo_push_token
-- the only omission.
--
-- Roles: postgres owns the table and service_role bypasses privilege checks, so
-- neither needs a re-grant — the revoke below names only the two client roles.
-- Matches migration 057, which likewise re-granted to `authenticated` only.
--
-- Re-runnable: REVOKE/GRANT are idempotent by nature.
-- ============================================================================

REVOKE SELECT ON public.profiles FROM authenticated, anon;

GRANT SELECT (
  id,
  role,
  provider_type,
  full_name,
  phone,
  business_name,
  avatar_url,
  is_approved,
  document_url,
  balance,
  is_online,
  created_at,
  updated_at,
  avg_delivery_minutes,
  rejected_at,
  rejection_reason,
  document_type,
  -- expo_push_token deliberately omitted — see header.
  display_id,
  loyalty_tier,
  last_loyalty_month
) ON public.profiles TO authenticated, anon;
