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
-- Migration: 2026-08-18_observation-gap-discovery.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Let observation coverage gaps become swim-spot discovery candidates in
--   the review queue that already exists (spot_suggestions), rather than
--   building a second review system. Three changes, all additive:
--     1. user_id becomes nullable — a machine-generated suggestion has no
--        submitting swimmer — with a CHECK that keeps it MANDATORY for
--        human submissions, so today's integrity is unchanged.
--     2. observation_station_id links a suggestion to the station that
--        produced it.
--     3. A partial unique index makes re-runs idempotent: one suggestion
--        per station, forever, however often the analysis runs.
--   No spot is ever created by this. Approval stays the existing human step.

-- Requested by:
--   Dave (coverage/discovery increment, 2026-08-18)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- 1. No existing row would violate the new "humans must have a user_id" rule
--    (expect: 0):
-- SELECT count(*) FROM spot_suggestions
--  WHERE user_id IS NULL AND source IS DISTINCT FROM 'observation_gap';
-- 2. The new column does not exist yet (expect: 0):
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='spot_suggestions'
--    AND column_name='observation_station_id';
-- 3. Current suggestion volume, for context (no rows are modified):
-- SELECT source, status, count(*) FROM spot_suggestions GROUP BY 1,2 ORDER BY 1,2;
-- This migration contains no UPDATE or DELETE of existing rows.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: ALTER ... DROP NOT NULL, ADD COLUMN, ADD CONSTRAINT and
-- CREATE INDEX only. No existing row is rewritten or removed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. A machine suggestion has no user. Human ones still must have one.
ALTER TABLE spot_suggestions ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE spot_suggestions
  ADD CONSTRAINT spot_suggestions_user_required_for_humans
  CHECK (user_id IS NOT NULL OR source = 'observation_gap');

-- 2. Which station produced this suggestion (null for human submissions).
ALTER TABLE spot_suggestions
  ADD COLUMN IF NOT EXISTS observation_station_id uuid
  REFERENCES observation_stations(id) ON DELETE SET NULL;

-- 3. Idempotency: one suggestion per station, ever. Without this the
--    hourly analysis would file the same finding again on every run.
CREATE UNIQUE INDEX IF NOT EXISTS spot_suggestions_one_per_station
  ON spot_suggestions (observation_station_id)
  WHERE observation_station_id IS NOT NULL;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- Reversible only while no machine-generated rows exist; if any do, delete
-- them first (they are identifiable by source='observation_gap').
-- BEGIN;
-- DROP INDEX IF EXISTS spot_suggestions_one_per_station;
-- ALTER TABLE spot_suggestions DROP COLUMN IF EXISTS observation_station_id;
-- ALTER TABLE spot_suggestions DROP CONSTRAINT IF EXISTS spot_suggestions_user_required_for_humans;
-- DELETE FROM spot_suggestions WHERE user_id IS NULL;   -- only if re-adding NOT NULL
-- ALTER TABLE spot_suggestions ALTER COLUMN user_id SET NOT NULL;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT is_nullable FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='spot_suggestions' AND column_name='user_id';
--   -- expect: YES
-- SELECT conname FROM pg_constraint
--  WHERE conrelid='public.spot_suggestions'::regclass
--    AND conname='spot_suggestions_user_required_for_humans';
--   -- expect: 1 row
-- SELECT indexname FROM pg_indexes
--  WHERE tablename='spot_suggestions' AND indexname='spot_suggestions_one_per_station';
--   -- expect: 1 row
-- SELECT count(*) FROM spot_suggestions WHERE source='observation_gap';
--   -- expect: 0 (this migration creates no suggestions)

-- ----------------------------------------------------------------
-- KNOWN INCONSISTENCY, deliberately NOT changed here
-- ----------------------------------------------------------------
-- spot_suggestions' admin RLS policies name a literal user UUID
-- (sql/applied/spot_suggestions_admin_rls.sql) while every other admin
-- surface in the project gates on profiles.is_admin. That is worth fixing,
-- but it is an authorisation change affecting existing human submissions and
-- does not belong in a migration about observation coverage.
