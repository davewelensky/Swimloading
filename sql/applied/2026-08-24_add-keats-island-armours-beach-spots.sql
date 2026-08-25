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
-- Migration: 2026-08-24_add-keats-island-armours-beach-spots.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Adds the 2 spots for Chloe Speakman's (cspeakma@icloud.com) Sunshine
--   Coast / Salish Sea crossing (Keats Island -> Armours Beach, Gibsons,
--   BC) so her "write in" spot request has somewhere to land right away,
--   instead of waiting on the wider Northeast Pacific coverage expansion.
--   Coordinates supplied directly by Dave. This is the first coverage
--   anywhere on the Sunshine Coast — before this, the only Canadian spot
--   in the whole database was English Bay, Vancouver (~40km away, across
--   the Strait of Georgia, not the same body of water Chloe swims in).

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT id, name, code FROM spots WHERE lower(name) IN ('keats island','armours beach')
--    OR code IN ('KEATS_ISLAND','ARMOURS_BEACH');
--   -- expect: 0 rows (confirmed clear of spots_name_ci_uniq / spots_code_uq before writing this file)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — pure INSERT, nothing existing is touched. Rollback below
-- is a plain DELETE by id.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO spots (name, domain, latitude, longitude, code, country_code, water_type, active)
VALUES
  ('Keats Island',   'CANADA', 49.395992, -123.482845, 'KEATS_ISLAND',   'CA', 'OCEAN', true),
  ('Armours Beach',  'CANADA', 49.404904, -123.501586, 'ARMOURS_BEACH',  'CA', 'OCEAN', true);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM spots WHERE code IN ('KEATS_ISLAND', 'ARMOURS_BEACH');
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT id, name, code, domain, country_code, water_type, latitude, longitude, active
-- FROM spots WHERE code IN ('KEATS_ISLAND', 'ARMOURS_BEACH');
--   -- expect: 2 active rows, domain=CANADA, country_code=CA, water_type=OCEAN,
--   -- coordinates matching the values above
