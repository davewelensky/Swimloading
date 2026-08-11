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
-- Migration: 2026-08-11_add-canada.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Add Canada as SwimLoading's 14th country: a `countries` row (CA,
--   is_domestic=false → International-tab treatment) and a `domains` row
--   (CANADA region) so Canadian spots can be created and classified.
--   Follows EXPANDING.md "Adding a New Country" Step 3 exactly.

-- Requested by:
--   Dave, 2026-08-11 — first Canadian spot suggestion arrived (English Bay,
--   Vancouver) via the new Spot Contribution system; a real swimmer is
--   logging from the northeast Pacific.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM countries WHERE iso_code = 'CA';   -- expect: 0
-- SELECT count(*) FROM domains  WHERE code = 'CANADA';    -- expect: 0
-- SELECT max(sort_order) FROM domains;                    -- expect: 133 (SPAIN) → CANADA gets 134

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- INSERT-only with ON CONFLICT DO NOTHING — no existing data touched.
-- No backup table required.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO countries (iso_code, name, continent, is_domestic)
VALUES ('CA', 'Canada', 'North America', false)
ON CONFLICT (iso_code) DO NOTHING;

INSERT INTO domains (code, display_name, is_coastal, sort_order, country_code)
VALUES ('CANADA', 'Canada', true, 134, 'CA')
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM domains  WHERE code = 'CANADA'   AND NOT EXISTS (SELECT 1 FROM spots WHERE domain = 'CANADA');
-- DELETE FROM countries WHERE iso_code = 'CA'  AND NOT EXISTS (SELECT 1 FROM spots WHERE country_code = 'CA');
-- COMMIT;
-- (Guards refuse to orphan any spot that has since been created.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT iso_code, name, continent, is_domestic FROM countries WHERE iso_code='CA';
--   -- expect: 1 row, is_domestic = false
-- SELECT code, display_name, is_coastal, sort_order, country_code FROM domains WHERE code='CANADA';
--   -- expect: 1 row, coastal, sort_order 134, country_code CA
