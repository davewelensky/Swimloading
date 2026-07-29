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
-- Migration: 2026-07-29_uk-challenge-go-live.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Go-live for The Great UK Swim Spot Challenge (TRIHARD). Was seeded
--   disabled/test_mode with placeholder dates (Aug 1 – Sep 30). Dave
--   confirmed 2026-07-29 the real window is August 2026 ONLY, and it
--   goes live the same day as the 1 August newsletter announcing it.
--   Sets enabled=true, test_mode=false, end_date to 2026-08-31 — same
--   go-live pattern as `UPDATE june_challenge_config SET test_mode =
--   false` used for the June challenge.

-- Requested by:
--   Dave — 2026-07-29, July/August newsletter build

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT id, slug, enabled, test_mode, launch_date, end_date
--   FROM campaigns WHERE slug = 'uk_swim_spot_challenge';
-- -- Confirmed 2026-07-29 (via read-only MCP):
-- -- id=ada273cc-0574-47e0-ba01-233cbaa36a85, enabled=false, test_mode=true,
-- -- launch_date=2026-08-01, end_date=2026-09-30
-- -- Affected rows for the UPDATE below: 1 (single seeded campaign row)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260729_campaigns AS
  SELECT * FROM campaigns WHERE slug = 'uk_swim_spot_challenge';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE campaigns
SET enabled = true,
    test_mode = false,
    end_date = '2026-08-31'
WHERE slug = 'uk_swim_spot_challenge';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- UPDATE campaigns
-- SET enabled = false, test_mode = true, end_date = '2026-09-30'
-- WHERE slug = 'uk_swim_spot_challenge';
-- -- (equivalently: restore the single row from _bak_20260729_campaigns)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT slug, enabled, test_mode, launch_date, end_date
--   FROM campaigns WHERE slug = 'uk_swim_spot_challenge';
-- -- expect: enabled=true, test_mode=false, launch_date=2026-08-01,
-- --         end_date=2026-08-31
