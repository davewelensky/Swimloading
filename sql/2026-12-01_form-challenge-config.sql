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
-- Migration: 2026-12-01_form-challenge-config.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Move the in-app challenge window to the 12 Swims of Christmas so points and
--   the live activity feed run during it. The FORM standings do not depend on this.

-- Requested by:
--   Dave — 27 Nov 2026.

-- DO NOT APPLY BEFORE 1 DECEMBER 2026 (SAST): it would end November's window early.
-- November's draw is unaffected afterwards (the draw script passes its own dates).

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date;                -- expect: 2026-12-01 or later
-- SELECT launch_date, end_date FROM june_challenge_config WHERE id = 1;   -- expect: 2026-11-01, 2026-11-30

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20261201_june_challenge_config AS
  SELECT * FROM june_challenge_config WHERE id = 1;
ALTER TABLE _bak_20261201_june_challenge_config ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

DO $$
BEGIN
  IF (now() AT TIME ZONE 'Africa/Johannesburg')::date < date '2026-12-01' THEN
    RAISE EXCEPTION 'Too early: apply on or after 1 December 2026 (SAST)';
  END IF;
END $$;

UPDATE june_challenge_config
   SET launch_date = '2026-12-01', end_date = '2027-01-06'
 WHERE id = 1;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE june_challenge_config c SET launch_date=b.launch_date, end_date=b.end_date
--   FROM _bak_20261201_june_challenge_config b WHERE c.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT launch_date, end_date, enabled, test_mode FROM june_challenge_config WHERE id = 1;  -- expect: 2026-12-01, 2027-01-06, true, false
