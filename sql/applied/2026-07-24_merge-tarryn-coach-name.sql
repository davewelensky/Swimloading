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
-- Migration: 2026-07-24_merge-tarryn-coach-name.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Normalise coach_name = 'Tarryn Stanford' → 'Tarryn' on club_sessions
--   (Aquasharks). Same real coach (club_coaches row, tarrynstanford@gmail.com)
--   logged under two different free-text name strings, so the coach
--   reliability/audit report groups her sessions as two separate "coaches".
--   Every other coach in this club is named by first name only (Ellen,
--   Kaisea, Britt) — standardising to match.

-- Requested by:
--   Dave (on Britt's behalf, Aquasharks) — found via the coach audit report

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_sessions WHERE coach_name = 'Tarryn Stanford';  -- expect: 26
-- SELECT count(*) FROM club_sessions WHERE coach_name = 'Tarryn';           -- expect: 42 (pre-merge)
-- SELECT count(*) FROM club_squad_sessions WHERE coach_name = 'Tarryn Stanford'; -- expect: 0 (templates already say 'Tarryn' only)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260724_club_sessions_tarryn AS
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
--   FROM _bak_20260724_club_sessions_tarryn b WHERE cs.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_sessions WHERE coach_name = 'Tarryn Stanford';  -- expect: 0
-- SELECT count(*) FROM club_sessions WHERE coach_name = 'Tarryn';           -- expect: 68 (42 + 26)
