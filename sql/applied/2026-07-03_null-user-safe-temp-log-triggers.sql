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
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-07-03_null-user-safe-temp-log-triggers.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Make temp_logs insert triggers safe for user_id = NULL (sensor logs).
--   fn_award_temp_log_points inserts into june_challenge_events (user_id
--   NOT NULL) and update_user_stats_on_log upserts into user_stats
--   (user_id NOT NULL) — both abort the whole temp_logs insert for
--   sensor rows, blocking the my-water.live hourly cron even after the
--   location_source constraint fix. Sensor logs must never award
--   challenge points or user streaks, so both functions now return
--   early when NEW.user_id IS NULL.

-- Requested by:
--   Dave (sensor-import debugging, 2026-07-03 — follow-up to
--   2026-07-03_allow-sensor-location-source.sql)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Reproduce the failure (roll back, nothing persists) — expect:
--   ERROR 23502 null value in column "user_id" of "june_challenge_events":
-- BEGIN;
-- INSERT INTO temp_logs (spot_id, user_id, temp_c, location_source, notes, logged_at)
-- VALUES ('27ab125b-5e62-4bda-b1fc-73ea4e86be9e', null, 20, 'sensor', 'test', now());
-- ROLLBACK;
-- Confirm no userless challenge events / user_stats rows exist (expect 0, 0):
-- SELECT count(*) FROM june_challenge_events WHERE user_id IS NULL;
-- SELECT count(*) FROM user_stats WHERE user_id IS NULL;

-- ----------------------------------------------------------------
-- BACKUP — not required: no rows deleted or updated.
-- Function replace only; original definitions preserved in ROLLBACK.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_award_temp_log_points()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  cfg           june_challenge_config%ROWTYPE;
  v_spot_name   TEXT;
  v_display     TEXT;
BEGIN
  -- Sensor / anonymous logs have no user — nothing to award
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO cfg FROM june_challenge_config WHERE id = 1;

  -- Bail out if challenge is off or outside date window
  IF cfg IS NULL
     OR NOT cfg.enabled
     OR NEW.created_at::date < cfg.launch_date
     OR NEW.created_at::date > cfg.end_date
  THEN
    RETURN NEW;
  END IF;

  -- Skip organiser/testers unless test_mode is on
  IF NOT cfg.test_mode AND (cfg.tester_ids @> ARRAY[NEW.user_id]::uuid[]) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_spot_name FROM spots WHERE id = NEW.spot_id;
  SELECT raw_user_meta_data->>'display_name' INTO v_display
    FROM auth.users WHERE id = NEW.user_id;

  -- Safe upsert — ON CONFLICT means double-inserts are silently ignored
  INSERT INTO june_challenge_events
    (user_id, display_name, action_type, points, spot_id, spot_name, ref_id, source, created_at)
  VALUES
    (NEW.user_id, v_display, 'temp_log', cfg.pts_temp_log,
     NEW.spot_id, v_spot_name, NEW.id::text, 'trigger', NEW.created_at)
  ON CONFLICT (ref_id, action_type) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_stats_on_log()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Sensor / anonymous logs have no user — no stats to update
    IF NEW.user_id IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO user_stats (user_id, total_logs, points, current_streak, last_log_date)
    VALUES (NEW.user_id, 1, 10, 1, CURRENT_DATE)
    ON CONFLICT (user_id) DO UPDATE
    SET
        total_logs = user_stats.total_logs + 1,
        points = user_stats.points + 10,
        last_log_date = CURRENT_DATE,
        current_streak = CASE
            WHEN user_stats.last_log_date = CURRENT_DATE - INTERVAL '1 day' THEN user_stats.current_streak + 1
            WHEN user_stats.last_log_date = CURRENT_DATE THEN user_stats.current_streak
            ELSE 1
        END,
        longest_streak = GREATEST(
            user_stats.longest_streak,
            CASE
                WHEN user_stats.last_log_date = CURRENT_DATE - INTERVAL '1 day' THEN user_stats.current_streak + 1
                WHEN user_stats.last_log_date = CURRENT_DATE THEN user_stats.current_streak
                ELSE 1
            END
        ),
        updated_at = NOW();
    RETURN NEW;
END;
$function$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — restore original functions (identical minus the guard).
-- ----------------------------------------------------------------
-- Re-run the two CREATE OR REPLACE statements above with the
-- "IF NEW.user_id IS NULL THEN RETURN NEW; END IF;" blocks removed.
-- Original definitions captured 2026-07-03 via pg_get_functiondef
-- before this migration; they differ ONLY by the guard blocks.

-- ----------------------------------------------------------------
-- VERIFY — run AFTER applying.
-- ----------------------------------------------------------------
-- Sensor insert now succeeds AND awards nothing (transactional test):
-- BEGIN;
-- INSERT INTO temp_logs (spot_id, user_id, temp_c, location_source, notes, logged_at)
-- VALUES ('27ab125b-5e62-4bda-b1fc-73ea4e86be9e', null, 20, 'sensor', 'verify test', now())
-- RETURNING id;                                        -- expect: 1 row
-- SELECT count(*) FROM june_challenge_events WHERE user_id IS NULL;  -- expect: 0
-- SELECT count(*) FROM user_stats WHERE user_id IS NULL;             -- expect: 0
-- ROLLBACK;
-- Then after the next hourly cron run:
-- SELECT spot_id, temp_c, logged_at FROM temp_logs
--   WHERE location_source = 'sensor' ORDER BY created_at DESC LIMIT 4;
--   -- expect: Tooting Bec + Brockwell rows
