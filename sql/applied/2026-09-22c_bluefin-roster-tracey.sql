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
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-09-22c_bluefin-roster-tracey.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Start the Blue Fin roster (CLUB_ONBOARDING.md Step 4) with the one
--   confirmed person: Tracey Steyn, as member #1, member_type 'coach',
--   assigned to Masters Squad, linked directly to her existing SwimLoading
--   account (skips the join-link step since she's already a known user).
--   The rest of the roster (~20 ladies, 10 kids) is still outstanding —
--   see project-bluefin-onboarding.md memory.

-- Requested by:
--   Dave — "add tracey as the first member in the roster"

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Already run read-only:
--   SELECT count(*) FROM club_roster WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin');
--     -> 0 (empty roster — this is a pure INSERT, no existing rows touched)
--   SELECT id FROM club_squads WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin') AND name='Masters Squad';
--     -> 501da6d8-e264-4f7e-b74d-a9ec0c5177d9
--   Tracey's profile id (from earlier migration): f39ec11b-f328-44fe-bd4c-767b0f3a99e0

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not applicable — INSERT only.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO club_roster (
  club_id, member_number, display_name, user_id, member_type,
  squad_id, is_trial, fee_paid, is_active
)
VALUES (
  (SELECT id FROM clubs WHERE slug = 'bluefin'),
  1,
  'Tracey Steyn',
  'f39ec11b-f328-44fe-bd4c-767b0f3a99e0',
  'coach',
  '501da6d8-e264-4f7e-b74d-a9ec0c5177d9',
  false,
  true,
  true
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DELETE FROM club_roster WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin')
--   AND member_number = 1 AND display_name = 'Tracey Steyn';

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT member_number, display_name, member_type, is_active FROM club_roster
--   WHERE club_id = (SELECT id FROM clubs WHERE slug = 'bluefin');
--   -- expect: 1 row — #1, Tracey Steyn, coach, active
