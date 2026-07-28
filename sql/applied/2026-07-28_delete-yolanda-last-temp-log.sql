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
-- Migration: 2026-07-28_delete-yolanda-last-temp-log.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Delete Yolanda Carstens' open-water temp log at her request
--   (16.7°C, Cottesloe Beach, Strava import "Open Water Swim",
--   2026-07-27 22:57:23 UTC), and correct the side effects the DELETE
--   trigger does not cover: user_stats counters (INSERT-only trigger)
--   and the strava_imports link (no FK — would dangle and block re-import).
--   june_challenge_events is cleaned automatically by trg_remove_temp_log_points.

-- Requested by:
--   Yolanda Carstens (carstens.yolanda@yahoo.com) via Dave —
--   confirmed by Dave: the OWS (Cottesloe) entry, not the Claremont pool one.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Expect exactly 1 row: the 16.7°C Cottesloe Beach log
SELECT id, spot_id, temp_c, notes, created_at
FROM temp_logs
WHERE id = 'aa76f165-d1c7-4967-924c-4519688ce582'
  AND user_id = '8073c5b3-8de7-486a-aab9-9ba4f6754ae7';

-- Expect 1 row: linked Strava import (activity 19492050324)
SELECT id, strava_activity_id FROM strava_imports
WHERE imported_to_log_id = 'aa76f165-d1c7-4967-924c-4519688ce582';

-- Expect 1 row: challenge event (15 pts) — removed automatically by delete trigger
SELECT id, points FROM june_challenge_events
WHERE ref_id = 'aa76f165-d1c7-4967-924c-4519688ce582' AND action_type = 'temp_log';

-- Expect: total_logs=67, points=670
SELECT total_logs, points FROM user_stats
WHERE user_id = '8073c5b3-8de7-486a-aab9-9ba4f6754ae7';

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260728_temp_logs_yolanda AS
SELECT * FROM temp_logs
WHERE id = 'aa76f165-d1c7-4967-924c-4519688ce582';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Unlink the Strava import so the activity no longer points at a
--    deleted log and can be re-imported if she wants it back. (1 row)
UPDATE strava_imports
SET imported_to_log_id = NULL
WHERE imported_to_log_id = 'aa76f165-d1c7-4967-924c-4519688ce582';

-- 2. Delete the temp log. trg_remove_temp_log_points also deletes the
--    matching june_challenge_events row (15 pts). (1 row)
DELETE FROM temp_logs
WHERE id = 'aa76f165-d1c7-4967-924c-4519688ce582'
  AND user_id = '8073c5b3-8de7-486a-aab9-9ba4f6754ae7';

-- 3. Reverse the user_stats increments from update_user_stats_on_log,
--    which fires on INSERT only. Streak fields untouched: her Claremont
--    log from the same day keeps last_log_date/streak correct. (1 row)
UPDATE user_stats
SET total_logs = total_logs - 1,
    points     = points - 10,
    updated_at = NOW()
WHERE user_id = '8073c5b3-8de7-486a-aab9-9ba4f6754ae7';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- INSERT INTO temp_logs SELECT * FROM _bak_20260728_temp_logs_yolanda;
--   -- NOTE: re-insert re-fires the award triggers, restoring the
--   -- june_challenge_events row and re-incrementing user_stats.
--   -- If enforce_no_backdating blocks it, temporarily:
--   -- ALTER TABLE temp_logs DISABLE TRIGGER enforce_no_backdating; (then re-enable)
-- UPDATE strava_imports SET imported_to_log_id = 'aa76f165-d1c7-4967-924c-4519688ce582'
--   WHERE strava_activity_id = 19492050324;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM temp_logs
--   WHERE id = 'aa76f165-d1c7-4967-924c-4519688ce582';            -- expect: 0
-- SELECT count(*) FROM june_challenge_events
--   WHERE ref_id = 'aa76f165-d1c7-4967-924c-4519688ce582';        -- expect: 0
-- SELECT imported_to_log_id FROM strava_imports
--   WHERE strava_activity_id = 19492050324;                       -- expect: NULL
-- SELECT total_logs, points FROM user_stats
--   WHERE user_id = '8073c5b3-8de7-486a-aab9-9ba4f6754ae7';       -- expect: 66, 660
-- SELECT count(*) FROM _bak_20260728_temp_logs_yolanda;           -- expect: 1
