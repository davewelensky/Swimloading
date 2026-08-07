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
-- Migration: 2026-08-07_re-merge-tarryn-coach-name.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Re-run the 24 Jul 'Tarryn Stanford' -> 'Tarryn' merge on club_sessions.
--   That migration only caught rows that existed as of 24 Jul — every
--   session she's started since then (her profile display_name is her
--   full name, pulled fresh into coach.html's `coachName` on every login)
--   kept reintroducing 'Tarryn Stanford', splitting her attendance-trend
--   history in two again. Companion code fix (coach.html, this session)
--   now truncates coachName to first-name-only at the source so this
--   should not recur — this migration just cleans up what already drifted
--   between 24 Jul and today (7 Aug).

-- Requested by:
--   Dave (on Britt's behalf, Aquasharks) — found while fixing the
--   Attendance Trend "same numbers every day" bug

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_sessions WHERE coach_name = 'Tarryn Stanford';  -- expect: 31
-- SELECT count(*) FROM club_sessions WHERE coach_name = 'Tarryn';           -- expect: 68 (pre-merge, from 24 Jul migration)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260807_club_sessions_tarryn AS
  SELECT * FROM club_sessions WHERE coach_name = 'Tarryn Stanford';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE club_sessions SET coach_name = 'Tarryn' WHERE coach_name = 'Tarryn Stanford';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- UPDATE club_sessions cs SET coach_name = 'Tarryn Stanford'
--   FROM _bak_20260807_club_sessions_tarryn b WHERE cs.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_sessions WHERE coach_name = 'Tarryn Stanford';  -- expect: 0
-- SELECT count(*) FROM club_sessions WHERE coach_name = 'Tarryn';           -- expect: 99 (68 + 31)
