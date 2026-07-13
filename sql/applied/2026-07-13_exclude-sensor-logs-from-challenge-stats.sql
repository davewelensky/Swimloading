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
-- Migration: 2026-07-13_exclude-sensor-logs-from-challenge-stats.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   get_challenge_month_stats() counts ALL rows in temp_logs (count(*)),
--   which includes automated sensor readings from api/cron/sensor-import.js
--   (location_source='sensor', user_id=null, hourly for Tooting Bec +
--   Brockwell lidos, live since 2026-07-03). This inflated "Temp Logs" on
--   the admin "Challenge — This Month" panel to 617 for Jul 1-13 (470 of
--   those are sensor rows), while "Swimmers Logging" correctly excludes
--   nulls via count(distinct user_id) and showed a real decline (35, -33%).
--   Real swimmer logs Jul 1-13 = 147, down from 193 the same window in June
--   (sensor cron wasn't live yet in June). Fix: exclude sensor rows from
--   both the current and previous-month log counts so the pace-check
--   compares swimmer activity to swimmer activity. get_challenge_leaders()
--   (Already Qualified / Active Participants) is unaffected — it reads
--   june_challenge_events, a per-user points ledger, not raw temp_logs.
--   This does not touch the sensor import itself — it's still correct for
--   the dashboard/Trends/conditions feed, just excluded from this one stat.

-- Requested by:
--   Dave — spotted the 617-logs-but-35-swimmers mismatch in the admin panel.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM temp_logs WHERE location_source = 'sensor';
--   -- expect: 470+ (grows each hour)
-- SELECT * FROM get_challenge_month_stats();
--   -- expect (before fix): cur_logs ~617

-- ----------------------------------------------------------------
-- BACKUP — not required (function replacement only, no data changes).
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.get_challenge_month_stats()
 RETURNS TABLE(cur_launch date, cur_end date, elapsed_days integer, cur_logs bigint, cur_swimmers bigint, cur_group_swims bigint, cur_qualified bigint, cur_active_participants bigint, prev_launch date, prev_end date, prev_logs_same_window bigint, prev_swimmers_same_window bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg june_challenge_config%ROWTYPE;
  v_now date;
  v_elapsed int;
  v_prev_launch date;
  v_prev_end date;
  v_prev_window_end date;
BEGIN
  SELECT * INTO v_cfg FROM june_challenge_config WHERE id = 1;
  v_now := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_elapsed := least(v_now, v_cfg.end_date) - v_cfg.launch_date + 1;

  -- previous calendar month
  v_prev_launch := (v_cfg.launch_date - interval '1 month')::date;
  v_prev_end    := (v_cfg.launch_date - interval '1 day')::date;
  v_prev_window_end := v_prev_launch + (v_elapsed - 1);

  RETURN QUERY
  SELECT
    v_cfg.launch_date, v_cfg.end_date, v_elapsed,
    (SELECT count(*) FROM temp_logs t WHERE (t.created_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN v_cfg.launch_date AND v_now AND t.location_source IS DISTINCT FROM 'sensor'),
    (SELECT count(DISTINCT t.user_id) FROM temp_logs t WHERE (t.created_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN v_cfg.launch_date AND v_now),
    (SELECT count(*) FROM swim_events e WHERE (e.created_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN v_cfg.launch_date AND v_now),
    (SELECT count(*) FROM get_challenge_leaders() g WHERE g.qualified_for_draw AND NOT g.disqualified),
    (SELECT count(*) FROM get_challenge_leaders() g WHERE g.temp_logs_rewarded > 0),
    v_prev_launch, v_prev_end,
    (SELECT count(*) FROM temp_logs t WHERE (t.created_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN v_prev_launch AND v_prev_window_end AND t.location_source IS DISTINCT FROM 'sensor'),
    (SELECT count(DISTINCT t.user_id) FROM temp_logs t WHERE (t.created_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN v_prev_launch AND v_prev_window_end);
END;
$function$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — re-apply the previous definition (count(*) with no
-- location_source filter) via CREATE OR REPLACE FUNCTION, same body
-- otherwise. No data was changed, so this is a clean, safe revert.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT * FROM get_challenge_month_stats();
--   -- expect: cur_logs ~147 (was ~617), prev_logs_same_window unchanged
--   -- (193, since June window predates the sensor cron going live)
