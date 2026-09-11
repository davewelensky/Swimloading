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
-- Migration: 2026-09-11_admin-read-profiles-rls.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Add an admin-only SELECT policy on `profiles` (mirroring the existing
--   admin_read_analytics policy on analytics_events) so admin.html's
--   "Verified users" install-funnel metric can actually see all rows.
--   Today it only sees the logged-in admin's own row (profiles_select_own:
--   auth.uid() = id), so it always reads ~0/1 regardless of real signups —
--   confirmed via direct SQL: 50 profiles created in the last 48h, 69 in
--   the last 30 days, vs. the dashboard showing 0. Purely additive: does
--   not touch or replace profiles_select_own/profiles_update_own.

-- Requested by:
--   Dave (investigating a wrong-looking admin funnel screenshot, 11 Sep 2026)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM profiles WHERE created_at >= now() - interval '30 days';
--   -> 69 (confirms the real signup volume the dashboard should show)
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'profiles';
--   -> confirms only profiles_select_own (SELECT, auth.uid()=id) exists today

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- N/A — additive policy only, no data touched, nothing dropped.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE POLICY "admin_read_profiles" ON profiles
  FOR SELECT
  TO public
  USING (auth.email() = 'dave.welensky@gmail.com');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP POLICY "admin_read_profiles" ON profiles;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'profiles';
--   -> expect: profiles_select_own, profiles_update_own, "Users can insert own profile",
--      and the new admin_read_profiles (SELECT, auth.email() = 'dave.welensky@gmail.com')
-- (as dave.welensky@gmail.com) SELECT count(*) FROM profiles WHERE created_at >= now() - interval '30 days';
--   -> expect: 69 (matches the read-only pre-check above, no longer 0/1)
