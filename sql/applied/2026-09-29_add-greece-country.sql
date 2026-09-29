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
-- Migration: 2026-09-29_add-greece-country.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Add Greece to the countries table as an INTERNATIONAL country (is_domestic = false). SwimLoading classifies a spot as
--   international from spots.country_code -> countries.is_domestic; with no GR row a Greek spot would not be classified as
--   international and could appear among the South African spots. First Greek spot: the pending "Mykonos" suggestion
--   (Sarah Alexander, 29 Sep 2026), which is approved afterwards through admin.html (Add New Spot form).
--   Same pattern as Italy / Portugal / Switzerland: country row + spots in the shared EUROPE domain.

-- Requested by:
--   Dave (29 Sep 2026).

-- Pre-checks (read-only, run 29 Sep 2026 before writing this file):
--   countries has no 'GR' row (0). Sibling rows for reference: IT/ES/PT/FR/HR are continent 'Europe', is_domestic false.
--   No spots with country_code 'GR' exist (0). Pending suggestion "Mykonos greece" has country_code GR.

-- Backup:
--   Not needed. INSERT of one new row only; no UPDATE / DELETE / DROP / TRUNCATE.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO countries (iso_code, name, continent, is_domestic)
VALUES ('GR', 'Greece', 'Europe', false)
ON CONFLICT (iso_code) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DELETE FROM countries WHERE iso_code = 'GR';   -- only safe while no spot uses country_code 'GR'

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
--   SELECT iso_code, name, continent, is_domestic FROM countries WHERE iso_code = 'GR';
--   -- expect exactly 1 row: GR, Greece, Europe, false
