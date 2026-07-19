-- ============================================================================
-- Tighten the profiles UPDATE RLS policy from PUBLIC to AUTHENTICATED.
-- ============================================================================
-- COSMETIC / defense-in-depth — this is NOT a behavior change. The existing
-- policy is `TO public` but its USING/WITH CHECK is `id = auth.uid() OR is_admin()`,
-- which already evaluates false for anon (whose auth.uid() is null and who is not
-- an admin) — so anon UPDATEs were already blocked. Scoping the policy to
-- `authenticated` means anon never even evaluates it and documents the intent.
--
-- The policy body is recreated BYTE-IDENTICAL to migration 000 (same USING and
-- WITH CHECK) — only the `TO authenticated` clause is added. Do not change the
-- predicate here; a typo would break every provider/customer profile edit.
--
-- Apply MANUALLY via the Supabase SQL Editor (never `supabase db push`).
-- Verify after applying: a logged-in user can still update their own row
-- (name/phone/avatar etc.), and `\d+ profiles` / pg_policies shows roles
-- {authenticated} on "profiles: users update own row".
-- ============================================================================

DROP POLICY IF EXISTS "profiles: users update own row" ON public.profiles;

CREATE POLICY "profiles: users update own row"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());
