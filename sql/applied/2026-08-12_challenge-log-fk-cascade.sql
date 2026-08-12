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
-- Migration: 2026-08-12_challenge-log-fk-cascade.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Swimmers cannot delete their own temp logs once a challenge has credited
--   them: eo_challenge_active_days.source_log_id and
--   campaign_location_credits.first_qualifying_log_id both reference
--   temp_logs with NO ACTION, so the delete bounces with an FK violation.
--   Change both to ON DELETE CASCADE: deleting a log withdraws the credit it
--   earned. Both systems re-award honestly afterwards — record_eo_active_day
--   re-inserts on the next log of the day, and the UK challenge has
--   recalc_campaign_scores. Cascade under-credits briefly; the old behaviour
--   blocked users from correcting their own mistakes. Never over-credits.

-- Requested by:
--   Dave, 2026-08-12 — Eugene Steynberg mislogged 14°C at Clifton 4th Beach
--   and got "violates foreign key constraint eo_challenge_active_days_
--   source_log_id_fkey" trying to delete it.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT conname, confdeltype FROM pg_constraint
--   WHERE conname IN ('eo_challenge_active_days_source_log_id_fkey',
--                     'campaign_location_credits_first_qualifying_log_id_fkey');
--   -- expect: 2 rows, both confdeltype='a' (NO ACTION)
-- SELECT count(*) FROM eo_challenge_active_days;      -- baseline (no rows modified)
-- SELECT count(*) FROM campaign_location_credits;     -- baseline (no rows modified)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Constraint re-definition only — zero rows touched by the migration itself.
-- (Future deletes will cascade by design; that is the point.)

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE eo_challenge_active_days
  DROP CONSTRAINT eo_challenge_active_days_source_log_id_fkey,
  ADD CONSTRAINT eo_challenge_active_days_source_log_id_fkey
    FOREIGN KEY (source_log_id) REFERENCES temp_logs(id) ON DELETE CASCADE;

ALTER TABLE campaign_location_credits
  DROP CONSTRAINT campaign_location_credits_first_qualifying_log_id_fkey,
  ADD CONSTRAINT campaign_location_credits_first_qualifying_log_id_fkey
    FOREIGN KEY (first_qualifying_log_id) REFERENCES temp_logs(id) ON DELETE CASCADE;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE eo_challenge_active_days
--   DROP CONSTRAINT eo_challenge_active_days_source_log_id_fkey,
--   ADD CONSTRAINT eo_challenge_active_days_source_log_id_fkey
--     FOREIGN KEY (source_log_id) REFERENCES temp_logs(id);
-- ALTER TABLE campaign_location_credits
--   DROP CONSTRAINT campaign_location_credits_first_qualifying_log_id_fkey,
--   ADD CONSTRAINT campaign_location_credits_first_qualifying_log_id_fkey
--     FOREIGN KEY (first_qualifying_log_id) REFERENCES temp_logs(id);
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT conname, confdeltype FROM pg_constraint
--   WHERE conname IN ('eo_challenge_active_days_source_log_id_fkey',
--                     'campaign_location_credits_first_qualifying_log_id_fkey');
--   -- expect: 2 rows, both confdeltype='c' (CASCADE)
-- SELECT count(*) FROM eo_challenge_active_days;      -- expect: same as baseline
-- SELECT count(*) FROM campaign_location_credits;     -- expect: same as baseline
