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
-- Migration: 2026-09-21_add-private-lessons-squad-aquasharks.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Add a "Private Lessons" squad for Aquasharks, not tied to any one
--   coach's name (unlike the existing Kaisea/Ellen/Britt Private squads).
--   Britt wants a shared bucket for ad hoc private lessons that aren't
--   necessarily with those three coaches — she registers the swimmer to
--   it via the existing "Trial session" one-off-visit feature (Roster →
--   Edit → Trial session → pick squad + date), same mechanism already
--   used for once-off catch-ups on a non-usual day.

-- Requested by:
--   Britt (Aquasharks admin), via Dave — 21 Sep 2026

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT name, type, sort_order, max_members FROM club_squads
--   WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' ORDER BY sort_order;
--   -> confirms Kaisea/Ellen/Britt Private all use type='lts', max_members=6,
--      sort_order 100/110/120 — new squad follows the same convention at 125
--      so it sits grouped with them, before Nippers (130+).
-- SELECT count(*) FROM club_squads WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
--   AND lower(name) = 'private lessons';
--   -> expect 0 (no existing squad with this name — not a duplicate)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- N/A — single INSERT only, nothing deleted or overwritten.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO club_squads (club_id, name, type, sort_order, max_members)
VALUES (
  '385e2c9d-b32e-47d1-bb1d-1e042523de23',
  'Private Lessons',
  'lts',
  125,
  6
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_<table>"
-- ----------------------------------------------------------------
-- DELETE FROM club_squads
--   WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
--   AND name = 'Private Lessons' AND sort_order = 125;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT id, name, type, sort_order, max_members FROM club_squads
--   WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND name = 'Private Lessons';
--   -> expect: one row, type='lts', sort_order=125, max_members=6
