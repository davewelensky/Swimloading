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
-- Migration: 2026-08-17_observation-providers-increment-2.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Register the Increment 2 observation providers: Marine Institute
--   Ireland (ERDDAP, enabled) and EMODnet Physics (disabled — probed
--   2026-08-17: no NRT water temperature on their public ERDDAP; enable
--   when a usable dataset exists, likely via CMEMS/Copernicus).

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM observation_providers WHERE code IN ('ireland_mi','emodnet');
--   -- expect: 0 (neither registered yet)
-- No UPDATE/DELETE in this migration.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: INSERT-only into observation_providers.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO observation_providers
  (code, name, provider_type, base_url, attribution, licence, enabled, poll_interval_minutes)
VALUES
  ('ireland_mi', 'Marine Institute Ireland', 'erddap',
   'https://erddap.marine.ie/erddap',
   'Data: Marine Institute Ireland',
   'Creative Commons Attribution 4.0 (Marine Institute data policy)',
   true, 60),
  ('emodnet', 'EMODnet Physics', 'erddap',
   'https://prod-erddap.emodnet-physics.eu/erddap',
   'Data: EMODnet Physics',
   'Free access; attribution required (EMODnet data policy). DISABLED: no NRT water temperature on public ERDDAP as of 2026-08-17.',
   false, 60)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM observation_providers WHERE code IN ('ireland_mi','emodnet');
-- COMMIT;
-- (Cascades to any observation_stations/observations rows those providers
--  created; safe while nothing is approved for a spot.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT code, enabled FROM observation_providers ORDER BY code;
--   -- expect: emodnet|f, ireland_mi|t, mywaterlive|f, ndbc|t
