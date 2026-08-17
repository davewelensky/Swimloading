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
-- Migration: 2026-08-17_cmems-insitu-provider.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Register the Copernicus Marine In Situ TAC provider (cmems_insitu) —
--   the network EMODnet redistributes, reached directly. Fixed moorings
--   with water temperature, read from the anonymous native mirror;
--   NetCDF-4 parsed by h5wasm in the ingestion cron. SwimLoading's
--   Copernicus account (registered by Dave 2026-08-17) satisfies the
--   licence's registration requirement.

-- Requested by:
--   Dave ("set up the copernicus credentials for emodnet", 2026-08-17)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM observation_providers WHERE code = 'cmems_insitu';
--   -- expect: 0
-- No UPDATE/DELETE in this migration.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: INSERT-only.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO observation_providers
  (code, name, provider_type, base_url, attribution, licence, enabled, poll_interval_minutes)
VALUES
  ('cmems_insitu', 'Copernicus Marine In Situ TAC', 'cmems_native',
   'https://s3.waw3-1.cloudferro.com/mdl-native-01/native/INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030',
   'Data: E.U. Copernicus Marine Service In Situ TAC',
   'Copernicus Marine Service licence — free with registration (account held); attribution and product citation required (INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030)',
   true, 60)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM observation_providers WHERE code = 'cmems_insitu';
-- COMMIT;
-- (Cascades to its stations/observations; safe while no cmems station is
--  an approved primary.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT code, enabled FROM observation_providers ORDER BY code;
--   -- expect: cmems_insitu|t, emodnet|f, ireland_mi|t, mywaterlive|f, ndbc|t
