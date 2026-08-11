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
-- Migration: 2026-08-11_dryland-auto-whole-squad.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Aquasharks' Wednesday 16:30-17:15 "Dry Land" session (squad_id =
--   Senior Squad, secondary_squad_id = Intermediate, custom_name already
--   'Dry Land') was set up as is_multisquad=true, which routes Mark
--   Attendance through explicit per-swimmer club_session_assignments.
--   Zero swimmers have ever been assigned, so the register shows empty —
--   Britt: "not open to coaches marking attendance for Senior & Junior
--   squad swimmers". Confirmed with Dave/Britt: they want EVERY active
--   Senior + Intermediate swimmer automatically available, not a
--   hand-picked subset. Flipping is_multisquad off (companion code
--   change makes a non-multisquad session's secondary_squad_id
--   auto-include that whole squad, same as a swimmer's own
--   secondary_squad_id already does) gets this without assignments.

-- Requested by:
--   Britt (Aquasharks), via Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT id, squad_id, secondary_squad_id, is_multisquad, custom_name
-- FROM club_squad_sessions WHERE id = '3292da81-3f17-4e8f-ac76-8e31f65ad210';
-- -- expect: 1 row, is_multisquad = true (pre-change)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Single boolean flip on one row, easily reversible (see ROLLBACK) — no
-- backup table needed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE club_squad_sessions
SET is_multisquad = false
WHERE id = '3292da81-3f17-4e8f-ac76-8e31f65ad210';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- UPDATE club_squad_sessions SET is_multisquad = true
-- WHERE id = '3292da81-3f17-4e8f-ac76-8e31f65ad210';

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT is_multisquad, secondary_squad_id, custom_name FROM club_squad_sessions
-- WHERE id = '3292da81-3f17-4e8f-ac76-8e31f65ad210';
-- -- expect: is_multisquad=false, secondary_squad_id=a1000001-0000-0000-0000-000000000006, custom_name='Dry Land'
