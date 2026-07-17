-- ============================================================================
-- prod-introspect.sql — READ-ONLY schema introspection for LPG Go / Supabase
-- ============================================================================
--
-- WHAT THIS IS
--   A read-only PostgreSQL schema-introspection script for the LPG Go mobile
--   app's Supabase backend. Paste it into the Supabase SQL Editor and run each
--   numbered section one at a time. Every section is a plain SELECT against the
--   system catalogs (pg_proc, pg_constraint, information_schema, pg_type,
--   pg_class, ...). It reads the REAL, live schema — not the migration files.
--
-- WHY IT EXISTS
--   Two Supabase projects back this app:
--     * lpg-go-dev   (ref rgqwaiassatyruptsgbs) — CURRENTLY LINKED; beta runs here.
--     * lpg-go-prod  (ref glurbbiyxlgnartwjbsz) — PAUSED and never inspected.
--   Before prod is unpaused and exposed to traffic, we need to diff prod's real
--   schema against dev's real schema. This script produces the raw material for
--   that diff: run it on dev, save the output; run it on prod, save the output;
--   diff the two, section by section. See "HOW TO DIFF DEV vs PROD" at the
--   bottom of this file.
--
-- WHY WE INTROSPECT THE CATALOG INSTEAD OF TRUSTING MIGRATION FILES
--   The migration ledger (supabase_migrations.schema_migrations) is STALE and
--   UNTRUSTWORTHY. On dev it records only migrations 000–029 as applied and
--   reports 030–085 as unapplied — yet functions introduced by 061 / 068 / 083
--   are provably live in pg_proc. Worse, at least one change exists ONLY in the
--   database and in NO migration file at all: a 6-argument place_order overload
--   was dropped by hand. So migration files record INTENT, not STATE. The live
--   catalog is the ONLY source of truth, and this script queries the catalog.
--
-- ============================================================================
-- !!  CRITICAL SAFETY WARNING — READ BEFORE TOUCHING EITHER PROJECT  !!
-- ============================================================================
--
--   * THIS SCRIPT IS READ-ONLY. It issues SELECTs against system catalogs only.
--     It creates nothing, alters nothing, drops nothing. It mutates NOTHING.
--
--   * NEVER run `supabase db push` against dev OR prod. EVER.
--       The ledger is stale (see above). A push trusts the ledger and would
--       replay ~50 already-applied migrations in NUMERIC order — e.g. running
--       044 before 083, re-running `DROP COLUMN stock`, re-adding constraints
--       that already exist, and re-creating functions out of order. This would
--       WRECK the database. There is no safe `db push` here.
--
--   * Schema changes are applied MANUALLY, via the Supabase SQL Editor, as new
--     numbered migration files. NEVER edit an already-applied migration file —
--     the file is a historical record, not a live spec.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Section 1: Functions (signatures, SECURITY DEFINER flag, search_path)
-- ----------------------------------------------------------------------------
-- WHAT TO LOOK FOR:
--   Every function in the 'public' schema, with its full argument list, return
--   type, whether it is SECURITY DEFINER, and its proconfig (which holds any
--   pinned search_path such as `search_path=public`, `search_path=''`).
--
--   Pay SPECIAL attention to the money / order-lifecycle RPCs:
--       place_order, accept_order, select_provider_for_order, confirm_delivery,
--       mark_delivered, cancel_order, set_order_eta, provider_withdraw
--   For EACH of these, verify:
--     - is_security_definer = true  (they run with definer privileges), AND
--     - proconfig pins a search_path (NULL proconfig = NO pinned search_path,
--       which is a privilege-escalation risk on a SECURITY DEFINER function), AND
--     - there are NO unexpected DUPLICATE overloads. Two known traps:
--         * a hand-dropped 6-arg place_order overload (must NOT reappear), and
--         * a vulnerable 2-arg select_provider_for_order overload.
--       If prod shows an overload that dev does not, investigate before unpausing.

SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type,
  p.prosecdef AS is_security_definer,
  p.proconfig AS config_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY
  p.proname,
  pg_get_function_identity_arguments(p.oid);


-- ----------------------------------------------------------------------------
-- Section 2: Constraints (CHECK, FK, PK, UNIQUE)
-- ----------------------------------------------------------------------------
-- WHAT TO LOOK FOR:
--   Every constraint on tables in the 'public' schema, with its full definition.
--   contype codes: 'c' = CHECK, 'f' = FOREIGN KEY, 'p' = PRIMARY KEY,
--                  'u' = UNIQUE, 'x' = EXCLUSION.
--
--   Confirm the phone-format CHECK on `profiles` is present: phone numbers must
--   be canonical +639XXXXXXXXX (13 characters total). Also confirm the
--   order-related constraints (FKs from orders to profiles/providers, status
--   CHECKs, amount CHECKs) match dev exactly.

SELECT
  rel.relname AS table_name,
  c.conname AS constraint_name,
  c.contype AS constraint_type,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
ORDER BY
  rel.relname,
  c.conname;


-- ----------------------------------------------------------------------------
-- Section 3: Columns (per-table schema)
-- ----------------------------------------------------------------------------
-- WHAT TO LOOK FOR:
--   The real column set for every table in 'public', in ordinal order, with
--   data type, nullability, and default. This is the ground truth of each
--   table's shape — compare it against dev to catch DRIFT. A concrete example:
--   the Phase C `stock` column was removed from products; if prod still has a
--   `stock` column and dev does not, that is drift no migration file explains.

SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY
  table_name,
  ordinal_position;


-- ----------------------------------------------------------------------------
-- Section 4: Table privileges / grants (the enforcement boundary)
-- ----------------------------------------------------------------------------
-- WHY THIS MATTERS:
--   In this project, money and order-lifecycle writes are locked at the GRANT
--   level, not merely behind RLS policies. RLS filters ROWS; a revoked grant
--   removes the PRIVILEGE entirely. Both layers must hold. Specifically:
--     - INSERT / UPDATE / DELETE on `orders` are REVOKED from client roles, and
--       UPDATE is re-granted ONLY on non-money columns (so clients cannot write
--       total_amount, etc. — those go through SECURITY DEFINER RPCs).
--     - `order_acceptances` is SELECT-only for clients (INSERT/UPDATE/DELETE
--       revoked).
--   VERIFY these revokes are actually present on prod. A grant that exists on
--   prod but was revoked on dev is a SECURITY HOLE — a client could bypass the
--   RPCs and write money columns directly. Flag any such difference.
--
--   (Note: role_table_grants lists grants that EXIST. A revoke shows up as the
--   ABSENCE of a row — so diff the full grant set against dev rather than
--   looking for an explicit "revoke" entry.)

SELECT
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
ORDER BY
  table_name,
  grantee,
  privilege_type;


-- ----------------------------------------------------------------------------
-- Section 5: Enums (esp. order_status)
-- ----------------------------------------------------------------------------
-- WHAT TO LOOK FOR:
--   Every enum type in 'public' with its labels in sort order. Confirm the
--   `order_status` enum's values match what the app expects, in this order:
--       pending, awaiting_dealer_selection, in_transit,
--       awaiting_confirmation, delivered, cancelled
--   A missing, extra, or reordered label between dev and prod is drift that
--   would break the order-lifecycle state machine.

SELECT
  t.typname AS enum_type,
  e.enumlabel AS enum_value,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY
  t.typname,
  e.enumsortorder;


-- ----------------------------------------------------------------------------
-- Section 6: RLS status
-- ----------------------------------------------------------------------------
-- WHAT TO LOOK FOR:
--   Row-Level Security state for every ordinary table (relkind = 'r') in
--   'public'. relrowsecurity = RLS enabled; relforcerowsecurity = RLS forced
--   even for the table owner. Every table holding user data MUST have RLS
--   enabled. FLAG any 'public' table with relrowsecurity = false — on this
--   project RLS is the enforcement boundary, and a table with RLS off is fully
--   exposed to any authenticated client.

SELECT
  rel.relname AS table_name,
  rel.relrowsecurity AS rls_enabled,
  rel.relforcerowsecurity AS rls_forced
FROM pg_class rel
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relkind = 'r'
ORDER BY
  rel.relname;


-- ============================================================================
-- HOW TO DIFF DEV vs PROD
-- ============================================================================
--
--   1. On DEV (ref rgqwaiassatyruptsgbs, currently linked, beta running):
--      open the Supabase SQL Editor and run EACH section above, one at a time.
--      Save each section's result set (CSV export or copy) labeled by section
--      number, e.g. dev-section-1-functions, dev-section-2-constraints, ...
--
--   2. On PROD (ref glurbbiyxlgnartwjbsz) — ONCE it has been UNPAUSED so the
--      SQL Editor is reachable — run the SAME sections, one at a time, and save
--      each result set labeled the same way: prod-section-1-functions, etc.
--
--   3. DIFF the two result sets SECTION BY SECTION (dev vs prod for section 1,
--      then section 2, and so on). A textual diff of the saved CSV/output is
--      enough; the ORDER BY clauses above make each section deterministic so
--      the diffs stay clean.
--
--   4. ANY difference is REAL schema drift. Because the migration ledger is
--      stale and at least one change (the hand-dropped 6-arg place_order) lives
--      only in the database, NO migration file is guaranteed to explain a
--      difference. Treat every diff as unexplained until you have investigated
--      it directly. Resolve ALL drift — especially in Section 1 (function
--      overloads / SECURITY DEFINER / search_path) and Section 4 (grants /
--      revokes) — BEFORE unpausing prod for real traffic.
--
--   REMINDER: never `supabase db push`. Apply any corrective schema change to
--   prod MANUALLY via the SQL Editor, as a new numbered migration file.
-- ============================================================================
