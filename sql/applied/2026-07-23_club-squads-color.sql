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
-- Migration: 2026-07-23_club-squads-color.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Add an optional colour swatch to club_squads so squads can be visually
--   distinguished in the admin UI (Squad Tracker, Roster, Timetable). Used
--   immediately to colour-code the 3 Nippers age-group squads (Aquasharks)
--   so Britt/coaches can tell "9am / 9:45 / 10:30" apart at a glance. NULL
--   for every other squad — no visual change for clubs/squads that don't
--   set one, including K8 (this column is shared but opt-in per squad row).

-- Requested by:
--   Dave (on Britt's behalf, Aquasharks)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_squads;                                    -- total squads, unaffected by ADD COLUMN
-- SELECT id, name FROM club_squads WHERE name ILIKE 'Nippers%';        -- expect 3 rows, the ones we'll set a colour on

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- ADD COLUMN is non-destructive (new nullable column, no existing data touched).
-- The UPDATE below only touches 3 rows and only sets a previously-NULL column,
-- so it's trivially reversible (see ROLLBACK) — no backup table needed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE club_squads ADD COLUMN IF NOT EXISTS color text;

UPDATE club_squads SET color = '#a78bfa' WHERE id = '615f48e4-cbc8-40d4-9d94-75e2f7c00dbb'; -- Nippers — Under 9s  (violet)
UPDATE club_squads SET color = '#f472b6' WHERE id = '84468a92-d611-4b37-8879-59ae7bb2b723'; -- Nippers — Under 10s (pink)
UPDATE club_squads SET color = '#fb923c' WHERE id = '27282127-9c2d-4354-a274-9bcb90473afe'; -- Nippers — Under 11s (orange)

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- UPDATE club_squads SET color = NULL WHERE id IN (
--   '615f48e4-cbc8-40d4-9d94-75e2f7c00dbb',
--   '84468a92-d611-4b37-8879-59ae7bb2b723',
--   '27282127-9c2d-4354-a274-9bcb90473afe'
-- );
-- ALTER TABLE club_squads DROP COLUMN color;  -- only if no other squad has set one since

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT id, name, color FROM club_squads WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' ORDER BY sort_order;
--   -- expect: Nippers — Under 9s = #a78bfa, Under 10s = #f472b6, Under 11s = #fb923c, every other squad's color = NULL
