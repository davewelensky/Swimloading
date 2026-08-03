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
-- Migration: 2026-08-03_james-channel-crossing-complete.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Mark James Kemp's English Channel crossing_attempts row as completed.
--   He swam it on 23 July 2026 (Dover -> Cap Gris-Nez, 33.8km, 12 hours,
--   coach Tim Denyer, pilot Pete Reed) but the row still shows status=
--   'active' with no record of the actual result. There is no dedicated
--   result column on this table, so the outcome is recorded in `notes`.

-- Requested by:
--   Dave, 2026-08-03 — confirmed the crossing date as 23 July and asked
--   to update the DB after the /crossings/english-channel and
--   /journeys/james-english-channel pages were updated to reflect it.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT id, user_id, target_date, status, coach_name, pilot_name, notes
-- FROM crossing_attempts
-- WHERE id = 'd2582a0d-aa2f-4659-9d3d-bd7e992aedde';
--   -- expect 1 row: status='active', target_date='2026-07-23',
--   --                coach_name='Tim Denyer', pilot_name='Pete Reed', notes=NULL
--
-- SELECT count(*) FROM crossing_attempts
-- WHERE id = 'd2582a0d-aa2f-4659-9d3d-bd7e992aedde' AND status = 'active';
--   -- expect: 1 (confirmed via read-only connection, 2026-08-03)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260803_crossing_attempts AS
SELECT * FROM crossing_attempts
WHERE id = 'd2582a0d-aa2f-4659-9d3d-bd7e992aedde';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE crossing_attempts
SET status     = 'completed',
    notes      = 'Completed 23 July 2026 — Dover to Cap Gris-Nez, 33.8km, 12 hours. Coach Tim Denyer, pilot Pete Reed.',
    updated_at = now()
WHERE id = 'd2582a0d-aa2f-4659-9d3d-bd7e992aedde'
  AND status = 'active';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- UPDATE crossing_attempts
-- SET status = b.status, notes = b.notes, updated_at = b.updated_at
-- FROM _bak_20260803_crossing_attempts b
-- WHERE crossing_attempts.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT id, status, notes, updated_at FROM crossing_attempts
-- WHERE id = 'd2582a0d-aa2f-4659-9d3d-bd7e992aedde';
--   -- expect: status='completed', notes mentions 23 July / 12 hours,
--   --          updated_at = today
