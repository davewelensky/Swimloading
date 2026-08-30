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
-- Migration: 2026-08-30_revoke-kaisea-coach-access.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Remove Kaisea Button's club_admins login row for Aquasharks so she can
--   no longer open the coach register. Her last coaching day is Mon 31 Aug
--   2026; Theresa de Freitas takes over her Learn to Swim & Stroke swimmers
--   from Tue 1 Sept. DO NOT APPLY BEFORE her Monday session has run.
--   This is exactly the gap the new "Revoke access" button (club-admin.html,
--   Coaching Staff card) now covers for future handovers — this migration
--   is a one-off for this specific cutover since the button ships same day.

-- Requested by:
--   Dave (relaying Britt's coach handover, 30 Aug 2026)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Confirms exactly one row: id 18b0e072-2f3d-46bd-bf4b-57378c61d559,
-- club_id 385e2c9d-b32e-47d1-bb1d-1e042523de23 (Aquasharks),
-- user_id 12dfac2d-3b62-49b8-8c4a-d59e38dc9414 (Kaisea Button,
-- kaiseabbutton@gmail.com), role 'coach'.
-- SELECT * FROM club_admins
--   WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
--     AND user_id = '12dfac2d-3b62-49b8-8c4a-d59e38dc9414'
--     AND role = 'coach';
-- expect: 1 row

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260830_club_admins_kaisea AS
SELECT * FROM club_admins
  WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
    AND user_id = '12dfac2d-3b62-49b8-8c4a-d59e38dc9414'
    AND role = 'coach';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

DELETE FROM club_admins
  WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
    AND user_id = '12dfac2d-3b62-49b8-8c4a-d59e38dc9414'
    AND role = 'coach';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- INSERT INTO club_admins SELECT * FROM _bak_20260830_club_admins_kaisea;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT * FROM club_admins
--   WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
--     AND user_id = '12dfac2d-3b62-49b8-8c4a-d59e38dc9414';
-- expect: 0 rows (her 'coach' row is gone; she never had any other role row
-- for this club, so this should be a clean 0)
