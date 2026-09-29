-- ================================================================
-- SwimLoading — Migration
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT - migration aborted. Expected swimloading (szgkzuswelntnevobnoh).';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-09-29_merge-coach-name-variants.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Aquasharks Audit page flags three coaches counted twice because past registers (club_sessions.coach_name)
--   hold both a first-name-only value and the full name. Rewrite the short form to the full form so each coach
--   is counted once: Teagan -> Teagan Thompson, Noah -> Noah Arelisky, Tarryn -> Tarryn Stanford.
--   The timetable already uses the full names (Teagan Thompson, Tarryn Stanford); nothing in it changes.

-- Requested by:
--   Dave (Audit page "Data Flags", 29 Sep 2026). Club: Aquasharks (385e2c9d-b32e-47d1-bb1d-1e042523de23).

-- Pre-checks (read-only, run 29 Sep 2026 before writing this file):
--   Rows to change: 121 (Teagan 41, Noah 39, Tarryn 41), all in the Aquasharks club; 0 rows in any other club.
--   club_sessions has only a primary-key uniqueness constraint; merging creates 0 collisions.
--   Each first name maps to exactly one full name in this club (Teagan Thompson, Noah Arelisky, Tarryn Stanford).
--   NOT touched: Kaisea, Ellen, Britt, Theresa, DaveW, the multi-coach values ("Teagan/Britt/Tarryn", "Tarryn/Teagan/Britt
--   (alternating Saturdays)") and the 60 registers with no coach name (cannot be attributed by renaming).

-- ----------------------------------------------------------------
-- BACKUP — required (UPDATE). Full copy of exactly the rows being changed.
-- ----------------------------------------------------------------
-- (created inside the migration transaction below, before the UPDATE)

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _bak_20260929_club_sessions AS
  SELECT * FROM club_sessions
  WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
    AND coach_name IN ('Teagan', 'Noah', 'Tarryn');

UPDATE club_sessions
   SET coach_name = CASE coach_name
        WHEN 'Teagan' THEN 'Teagan Thompson'
        WHEN 'Noah'   THEN 'Noah Arelisky'
        WHEN 'Tarryn' THEN 'Tarryn Stanford'
      END
 WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
   AND coach_name IN ('Teagan', 'Noah', 'Tarryn');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   UPDATE club_sessions c SET coach_name = b.coach_name
--     FROM _bak_20260929_club_sessions b WHERE c.id = b.id;
--   Backup table _bak_20260929_club_sessions is kept until a later migration removes it.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
--   SELECT count(*) FROM _bak_20260929_club_sessions;   -- expect 121
--   SELECT count(*) FROM club_sessions WHERE club_id='385e2c9d-b32e-47d1-bb1d-1e042523de23'
--      AND coach_name IN ('Teagan','Noah','Tarryn');     -- expect 0
--   SELECT coach_name, count(*) FROM club_sessions WHERE club_id='385e2c9d-b32e-47d1-bb1d-1e042523de23'
--      AND coach_name IN ('Teagan Thompson','Noah Arelisky','Tarryn Stanford') GROUP BY 1;
--      -- expect Teagan Thompson 184 (143+41), Noah Arelisky 58 (19+39), Tarryn Stanford 150 (109+41)
