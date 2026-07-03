-- ================================================================
-- SwimLoading — Migration
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
-- Migration: 2026-07-03_allow-sensor-location-source.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Allow location_source = 'sensor' on temp_logs so the hourly
--   my-water.live sensor cron (api/cron/sensor-import.js) can insert.
--   Every run has failed the check constraint since the cron shipped
--   (constraint allows only manual/gps/fallback; cron sends 'sensor').

-- Requested by:
--   Dave (spotted the recurring constraint-violation errors in
--   Supabase logs, 2026-07-03)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Current constraint definition (expect: manual/gps/fallback only):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'temp_logs_location_source_check';
-- No existing rows would violate the NEW constraint (expect: 0):
-- SELECT count(*) FROM temp_logs
--   WHERE location_source IS NOT NULL
--     AND location_source NOT IN ('manual','gps','fallback','sensor');
-- No sensor rows exist yet (expect: 0):
-- SELECT count(*) FROM temp_logs WHERE location_source = 'sensor';

-- ----------------------------------------------------------------
-- BACKUP — not required: no rows are deleted or updated.
-- Constraint swap only; existing data untouched.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE temp_logs
  DROP CONSTRAINT temp_logs_location_source_check;

ALTER TABLE temp_logs
  ADD CONSTRAINT temp_logs_location_source_check
  CHECK (location_source = ANY (ARRAY['manual'::text, 'gps'::text, 'fallback'::text, 'sensor'::text]));

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo.
-- (Only safe while no 'sensor' rows exist; after sensor rows land,
--  delete them first or they will violate the restored constraint.)
-- ----------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE temp_logs DROP CONSTRAINT temp_logs_location_source_check;
-- ALTER TABLE temp_logs ADD CONSTRAINT temp_logs_location_source_check
--   CHECK (location_source = ANY (ARRAY['manual'::text, 'gps'::text, 'fallback'::text]));
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'temp_logs_location_source_check';
--   -- expect: CHECK includes 'sensor'
-- Then after the next top-of-hour cron run:
-- SELECT spot_id, temp_c, location_source, logged_at, created_at
--   FROM temp_logs WHERE location_source = 'sensor'
--   ORDER BY created_at DESC LIMIT 5;
--   -- expect: rows for Tooting Bec + Brockwell Lido appearing hourly
