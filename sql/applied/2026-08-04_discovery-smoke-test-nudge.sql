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
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-04_discovery-smoke-test-nudge.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Smoke-test the newly deployed Railway crawler by making ONE source
--   (Oceanman — the smallest and fastest, 3 pages, currently 'healthy')
--   due immediately, instead of waiting until 2026-08-10 to find out
--   whether unattended scheduling works. The worker polls every 900s, so
--   it should pick this up within ~15 minutes and write a
--   discovery_runs row with run_type='scheduled'.
--
--   This changes ONE scheduling timestamp on ONE row. It touches no
--   swimmer, club, or event data. The crawler itself rewrites
--   next_run_at at the end of every run, so the value is transient by
--   design and self-corrects: after the test run, Oceanman returns to
--   its normal weekly cadence automatically.

-- Requested by:
--   Dave — "run the smoke test" (2026-08-04), after Railway deploy went live

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Affected-row count (expect exactly 1):
--   SELECT count(*) FROM discovery_sources
--   WHERE id = '00000000-0000-4000-8000-000000000010';
--
-- Current state (expect enabled=true, health 'healthy', next_run_at ~Aug 10):
--   SELECT name, enabled, health_status, next_run_at
--   FROM discovery_sources
--   WHERE id = '00000000-0000-4000-8000-000000000010';
--
-- Runs so far (expect only the manual/scheduled runs from 2026-08-03):
--   SELECT run_type, status, started_at FROM discovery_runs
--   WHERE source_id = '00000000-0000-4000-8000-000000000010'
--   ORDER BY started_at DESC;

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- The prior value is preserved so the nudge can be undone exactly.
CREATE TABLE IF NOT EXISTS _bak_20260804_discovery_source_schedule AS
  SELECT id, name, next_run_at, last_run_at, health_status, now() AS backed_up_at
  FROM discovery_sources
  WHERE id = '00000000-0000-4000-8000-000000000010';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE discovery_sources
SET next_run_at = now(),
    updated_at  = now()
WHERE id = '00000000-0000-4000-8000-000000000010';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- UPDATE discovery_sources s
-- SET next_run_at = b.next_run_at,
--     updated_at  = now()
-- FROM _bak_20260804_discovery_source_schedule b
-- WHERE s.id = b.id;
--
-- Rollback is only meaningful BEFORE the worker picks the source up; once
-- it runs, the crawler sets its own next_run_at (one week out) and the
-- source is back on its normal cadence regardless.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- Immediately after applying:
--   SELECT name, next_run_at <= now() AS is_due FROM discovery_sources
--   WHERE id = '00000000-0000-4000-8000-000000000010';
--   -- expect: is_due = true
--
-- Within ~15 minutes (the worker's poll interval):
--   SELECT run_type, status, pages_requested, pages_fetched, pages_changed,
--          candidates_found, started_at
--   FROM discovery_runs
--   WHERE source_id = '00000000-0000-4000-8000-000000000010'
--   ORDER BY started_at DESC LIMIT 1;
--   -- expect: a NEW row, run_type='scheduled', status='succeeded',
--   --         pages_fetched=3, candidates_found=0 (Oceanman's calendar is
--   --         JS-rendered, so 0 candidates is the CORRECT result here —
--   --         the test is proving the scheduler fires, not that Oceanman
--   --         yields events; that needs the future Playwright phase).
--   -- pages_changed should be 0 if the site is unchanged since 2026-08-03,
--   --         which additionally proves change-detection works.
--
--   SELECT next_run_at FROM discovery_sources
--   WHERE id = '00000000-0000-4000-8000-000000000010';
--   -- expect: ~1 week in the future again, set by the worker itself
