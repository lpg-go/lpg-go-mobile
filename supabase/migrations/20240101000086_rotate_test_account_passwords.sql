-- ============================================================================
-- Rotate the seeded test-account passwords — off a password the repo published
--
-- THE PROBLEM
-- -----------
-- Migration 083 (section 6) rotated the three seeded test accounts onto a shared
-- password and WROTE THAT PASSWORD, IN PLAINTEXT, INTO THE COMMITTED SQL. It
-- justified this as acceptable because the accounts are "DEV-ONLY accounts on a
-- non-production database".
--
-- That premise is wrong. Beta runs against the dev project. The rows in these
-- tables are real beta users' data, not fixtures. And the seeded Test Dealer is
-- is_approved = true, is_online = true, with a balance above min_balance — so
-- anyone who can read this repo can sign in as it, accept live beta orders, and
-- read real customers' names, phone numbers, and delivery addresses. That is a
-- working credential to other people's personal data, published to every past
-- and present reader of the repository.
--
-- It also violates the project's own rule (.claude/rules/security-hygiene.md):
-- "No API tokens, ... or other credentials in any file under .claude/, docs/,
-- source code, or test fixtures."
--
-- THE FIX
-- -------
-- Rotate. 083's password is BURNED PERMANENTLY — it is in git history, and git
-- history cannot be unpublished. Deleting the literal from HEAD would change
-- nothing about who can read it; only replacing the credential does. So this
-- migration sets a new password on exactly the three accounts 083 touched, and
-- nothing else.
--
-- The new plaintext is NOT in this file, and is not anywhere in the repo. It
-- lives in `.env.local` (gitignored, untracked) under TEST_ACCOUNT_PASSWORD.
-- That is where a teammate should look for it.
--
-- WHY A PRECOMPUTED HASH, NOT crypt()
-- -----------------------------------
-- 083 wrote `crypt('<plaintext>', gen_salt('bf'))`. That form STRUCTURALLY
-- requires the plaintext to be in the committed SQL — the whole defect, not an
-- incidental one. So this migration assigns the bcrypt digest directly instead.
--
-- This is safe and correct:
--   * auth.users.encrypted_password stores exactly this — a modular-crypt bcrypt
--     string. GoTrue compares the submitted password against it with bcrypt; it
--     does not care whether Postgres or something else produced the digest.
--   * The digest is not a usable credential. It is bcrypt at cost 10 over a
--     28-character random alphanumeric password (~166 bits of entropy). There is
--     no dictionary or brute-force path to the preimage.
-- The hash below was verified out-of-band to accept the correct password and
-- reject a wrong one. No plaintext, no crypt(), no pgcrypto dependency at all.
--
-- SCOPE — deliberately only the password. is_approved, is_online, balances, and
-- account existence are all left exactly as they are. Whether these accounts
-- should exist with those privileges on a database serving beta users is a real
-- question, but it is a separate change from rotating a leaked credential.
--
-- 083 is NOT edited: it is already applied, and .claude/rules/stack.md forbids
-- editing an applied migration. Its plaintext is permanent in git history, so
-- redacting it would buy false comfort at the cost of the rule. 086 supersedes
-- 083's section 6; 083 stays as the historical record of what happened.
-- ============================================================================

update auth.users
  set encrypted_password = '$2a$10$HEhbA/2dWpoXu1B.KDBzsetjaaSfreYVE3zlFRgO3gMjA9rYzknSK'
  where email in (
    '630000000000@lpggo.app',
    '631111111111@lpggo.app',
    '632222222222@lpggo.app'
  );
