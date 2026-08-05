-- ================================================================
-- SwimLoading — Migration Template
-- Copy this header into EVERY new migration file.
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT — MIGRATION ABORTED                       ║\n'
      '║                                                          ║\n'
      '║  This migration is for: SwimLoading                     ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh            ║\n'
      '║                                                          ║\n'
      '║  You are connected to a DIFFERENT Supabase project.     ║\n'
      '║  No changes have been made. Check your browser URL.     ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-03_protect-profiles-is-admin.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: trigger present (BEFORE
--            UPDATE), function is INVOKER not DEFINER, admin count
--            unchanged at 1. Functional test run in an aborted block —
--            (A) is_admin escalation rejected with the expected message,
--            (B) ordinary profile edits still succeed, (C) writing
--            is_admin to its existing value is allowed (the guard is
--            IS DISTINCT FROM, not a blanket ban on naming the column).
--            Note the test ran as the service role and was still blocked,
--            which is the intended no-bypass design — see the OPERATIONAL
--            NOTE below for how to grant an admin from now on.
--            Still outstanding: verify step 4, the authenticated-role run
--            of scripts/test-profile-is-admin-protection.mjs, which needs
--            TEST_USER_* credentials.
-- ================================================================

-- Purpose:
--   Close the profiles.is_admin self-escalation risk with the smallest
--   possible change: a BEFORE UPDATE trigger that rejects any UPDATE
--   which changes is_admin, while leaving every existing RLS policy,
--   every existing is_admin-gated admin feature, admin.html, and every
--   normal profile-field edit completely untouched. This is a narrow
--   security prerequisite, deliberately NOT the user_roles/has_role()/
--   grant_role()/revoke_role() model (that remains a separate, larger,
--   not-yet-scheduled piece of work).

-- Requested by:
--   Dave — SwimLoading v2 Platform Refactor, security prerequisite,
--   2026-08-03.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. Confirm the column exists with the expected shape (added by the
--    already-applied sql/applied/fix_new_signup_notifications.sql):
--      SELECT column_name, data_type, column_default
--      FROM information_schema.columns
--      WHERE table_name = 'profiles' AND column_name = 'is_admin';
--      -- expect: is_admin | boolean | false
--
-- 2. Confirm no trigger already protects is_admin (must be 0 rows —
--    if this returns >0, someone already added a similar guard; STOP
--    and re-investigate before proceeding):
--      SELECT trigger_name, event_manipulation, action_timing
--      FROM information_schema.triggers
--      WHERE event_object_table = 'profiles'
--        AND trigger_name = 'protect_profile_admin_fields';
--      -- expect: 0 rows
--
-- 3. List every trigger currently on profiles, for the record (informational).
--    Use pg_catalog, NOT information_schema: information_schema.triggers only
--    shows triggers whose function the querying role has rights on, and on
--    this database it returned ZERO rows — which would have read as "no
--    triggers at all" and is wrong.
--      SELECT t.tgname, pg_get_triggerdef(t.oid)
--        FROM pg_trigger t
--       WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
--       ORDER BY t.tgname;
--      -- ACTUAL 2026-08-05 — four, not the one this file first assumed:
--        on_onboarding_completed     AFTER  UPDATE OF onboarding_completed_at
--        on_profile_insert_set_email BEFORE INSERT
--        trg_identity_public_guard   BEFORE INSERT OR UPDATE
--        trg_sync_auth_display_name  AFTER  UPDATE OF display_name
--      -- None references is_admin (checked: prosrc ILIKE '%is_admin%' is
--      -- false for all four), so none is an existing guard and none is
--      -- made redundant by this migration.
--
-- 3b. Interaction with trg_identity_public_guard, the only other BEFORE
--     UPDATE trigger. Postgres fires same-timing row triggers in NAME order,
--     so 'protect_profile_admin_fields' < 'trg_identity_public_guard' means
--     ours raises FIRST. An is_admin escalation is therefore rejected before
--     the identity guard runs, and the identity guard's own behaviour on
--     legitimate updates is unchanged because ours returns NEW untouched in
--     every non-escalation case.
--
-- 4. Confirm current admin count is unaffected by this migration
--    (informational baseline, not required to match a specific number —
--    this migration does not change any is_admin VALUE, only the
--    ability to change it):
--      SELECT count(*) FROM profiles WHERE is_admin = true;

-- ----------------------------------------------------------------
-- BACKUP — not required. This migration adds a function and a trigger
-- only; it does not ALTER, UPDATE, DELETE, or DROP any existing row,
-- column, policy, or data. Nothing to snapshot.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- SECURITY INVOKER (the default — no SECURITY DEFINER clause), deliberately.
-- This function only inspects NEW/OLD, values already supplied to the
-- trigger by the executor for every row in the UPDATE regardless of the
-- calling role's own SELECT grants — it needs no elevated privilege to
-- read them, and it performs no cross-table read or write of its own.
-- SECURITY DEFINER would grant this function the owning role's full
-- privileges for no functional benefit, which is an unnecessary privilege
-- increase for code whose only job is to raise an exception. SET
-- search_path is kept anyway, matching repo convention on every other
-- function, even though it has no exploitable effect here since the
-- function references no schema-qualified object.
CREATE OR REPLACE FUNCTION public.protect_profile_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'is_admin cannot be modified through profile updates';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_admin_fields ON public.profiles;

CREATE TRIGGER protect_profile_admin_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_admin_fields();

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo. Fully reversible; no data was changed.
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS protect_profile_admin_fields ON public.profiles;
-- DROP FUNCTION IF EXISTS public.protect_profile_admin_fields();
-- COMMIT;

-- ----------------------------------------------------------------
-- OPERATIONAL NOTE — read before ever needing to change is_admin again.
-- ----------------------------------------------------------------
-- This trigger has NO bypass mechanism, by design (smallest possible
-- change — no user_roles, no trusted-sync flag). The ONLY existing
-- precedent for setting is_admin at all is the one-off manual
-- `UPDATE profiles SET is_admin = TRUE WHERE id = '<uuid>'` in the
-- already-applied sql/applied/fix_new_signup_notifications.sql. If a
-- future admin needs to be granted the SAME way (direct SQL, not through
-- the app — there is no app UI path today, confirmed in the pre-check
-- report), that UPDATE will now be rejected by this trigger too, with no
-- exception carved out. The documented workaround for that rare, manual,
-- admin-only case is to bracket the one-off UPDATE:
--   ALTER TABLE public.profiles DISABLE TRIGGER protect_profile_admin_fields;
--   UPDATE profiles SET is_admin = true WHERE id = '<uuid>';
--   ALTER TABLE public.profiles ENABLE TRIGGER protect_profile_admin_fields;
-- This is intentionally left as a manual, deliberate, logged action
-- (each ALTER TABLE is its own explicit statement Dave must run) rather
-- than an automatic bypass — building an automatic bypass is exactly the
-- larger user_roles-based work this migration is deliberately NOT doing.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. Trigger exists and fires on UPDATE:
--      SELECT trigger_name, event_manipulation, action_timing, action_statement
--      FROM information_schema.triggers
--      WHERE event_object_table = 'profiles'
--        AND trigger_name = 'protect_profile_admin_fields';
--      -- expect: exactly 1 row, event_manipulation = UPDATE,
--      -- action_timing = BEFORE
--
-- 2. Function exists with invoker rights (not definer):
--      SELECT proname, prosecdef
--      FROM pg_proc
--      WHERE proname = 'protect_profile_admin_fields';
--      -- expect: prosecdef = false
--
-- 3. Existing admin count is unchanged (this migration must never change
--    a value, only protect it — compare against the pre-check #4 baseline):
--      SELECT count(*) FROM profiles WHERE is_admin = true;
--      -- expect: identical to the pre-check baseline
--
-- 4. Run scripts/test-profile-is-admin-protection.mjs --mode=authenticated-writes
--    with dedicated TEST_USER_* credentials (see script header) and confirm
--    all checks pass.
