-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected ref: szgkzuswelntnevobnoh';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-07-20_records-v1.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Personal Records V1 — Dave, Carina Bruwer, and Johan Branehog
--   ("tunnan") only. Additive-only: records_v1 feature
--   flag (off globally, allow-listed to these three), and one read RPC,
--   get_my_records_v1(), computing current + previous "best ever" for 10
--   record types entirely on demand from temp_logs / strava_imports /
--   swimmer_story_events. No new table, no generation trigger, no
--   backfill — deliberately SEPARATE from the Story Engine (no new
--   story_type is added, no swimmer_story_events row is ever written by
--   this migration) and SEPARATE from Identity
--   (swimmer_achievements is untouched).
--
--   "Link to Story if applicable": coldest/warmest cross-reference
--   swimmer_story_events (story_type = new_coldest_swim / new_warmest_
--   swim) via the SAME temp_log_id, returning that event's id so the
--   client can deep-link into the Story tab using the exact mechanism
--   built in Phase 2.3 (app-story-card.js's _scOpenTimeline pattern) —
--   no new deep-link machinery. The other 8 record types have no
--   corresponding story_type in the current 14-type enum, so their
--   story_event_id is simply null — "if applicable" is enforced by the
--   data, not a client-side guess.
--
--   DISTANCE / DURATION / PACE ARE STRAVA-ONLY, matching the existing
--   rule stated in app-identity.js's own header comment: "Distance/
--   duration shown ONLY when deterministically linked via
--   strava_imports.imported_to_log_id... never from temp_logs.
--   distance_km, never zero/blank/inferred." longest_swim,
--   longest_duration, and fastest_pace all join strava_imports via
--   imported_to_log_id and are simply absent (current/previous both
--   null) for a swimmer with no linked Strava activities, rather than
--   ever falling back to an unreliable field.
--
--   MOST_CONSECUTIVE_DAYS is recomputed via gaps-and-islands over
--   distinct SAST log dates on every call, rather than reading
--   user_stats.longest_streak — that column is a single mutable running
--   maximum with no history and no achieved-date, so it cannot answer
--   "previous" or "when." This RPC's version can.
--
--   COORDINATES: most_northern / most_southern use spots.latitude
--   (falling back to temp_logs.lat for GPS-only logs) purely as a sort
--   key server-side — raw latitude/longitude values are never included
--   in the returned jsonb, only the resolved spot name (or null).

-- Requested by:
--   Dave (SwimLoading Release 2.4, Records sub-request, 2026-07-20)

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM feature_flags WHERE key='records_v1';  -- expect: 0
-- SELECT count(*) FROM pg_proc WHERE proname IN
--   ('get_my_records_v1','records_v1_flag_enabled');  -- expect: 0

-- ----------------------------------------------------------------
-- BACKUP — not required, additive only.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Feature flag ──────────────────────────────────────────────
-- df137255-3add-4153-b368-32e06e2be188 = Dave
-- cff2fc33-4a55-451b-8c7f-20f12c1898ce = Carina Bruwer
-- becb6930-c952-46b0-ae03-741a0721004d = Johan Branehog ("tunnan")
INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('records_v1', false, ARRAY[
  'df137255-3add-4153-b368-32e06e2be188',
  'cff2fc33-4a55-451b-8c7f-20f12c1898ce',
  'becb6930-c952-46b0-ae03-741a0721004d'
]::uuid[])
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.records_v1_flag_enabled(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled_global OR p_user = ANY(allowed_user_ids)
       FROM feature_flags WHERE key = 'records_v1'),
    false);
$$;

REVOKE ALL ON FUNCTION public.records_v1_flag_enabled(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.records_v1_flag_enabled(uuid) TO authenticated;

-- ── 2. get_my_records_v1 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_records_v1()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_records jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT records_v1_flag_enabled(v_uid) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;

  WITH
  temp_ranked AS (
    SELECT tl.id AS temp_log_id, tl.temp_c, COALESCE(tl.logged_at, tl.created_at) AS ts,
           sp.name AS spot_name,
           dense_rank() OVER (ORDER BY tl.temp_c ASC)  AS cold_rank,
           dense_rank() OVER (ORDER BY tl.temp_c DESC) AS warm_rank
    FROM temp_logs tl LEFT JOIN spots sp ON sp.id = tl.spot_id
    WHERE tl.user_id = v_uid
  ),
  coldest AS (
    SELECT 'coldest' AS record_type,
      (SELECT jsonb_build_object('value', temp_c, 'unit', '°C', 'when', ts, 'where', spot_name,
                'story_event_id', (SELECT id FROM swimmer_story_events WHERE user_id=v_uid AND temp_log_id=t.temp_log_id AND story_type='new_coldest_swim' LIMIT 1))
         FROM temp_ranked t WHERE cold_rank = 1 ORDER BY ts ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', temp_c, 'unit', '°C', 'when', ts, 'where', spot_name)
         FROM temp_ranked t WHERE cold_rank = 2 ORDER BY ts ASC LIMIT 1) AS previous
  ),
  warmest AS (
    SELECT 'warmest' AS record_type,
      (SELECT jsonb_build_object('value', temp_c, 'unit', '°C', 'when', ts, 'where', spot_name,
                'story_event_id', (SELECT id FROM swimmer_story_events WHERE user_id=v_uid AND temp_log_id=t.temp_log_id AND story_type='new_warmest_swim' LIMIT 1))
         FROM temp_ranked t WHERE warm_rank = 1 ORDER BY ts ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', temp_c, 'unit', '°C', 'when', ts, 'where', spot_name)
         FROM temp_ranked t WHERE warm_rank = 2 ORDER BY ts ASC LIMIT 1) AS previous
  ),
  -- Distance / duration / pace: Strava-only, joined via imported_to_log_id.
  strava_ranked AS (
    SELECT si.imported_to_log_id AS temp_log_id, si.distance_m, si.moving_time_seconds, si.elapsed_time_seconds,
           COALESCE(tl.logged_at, tl.created_at) AS ts, sp.name AS spot_name,
           dense_rank() OVER (ORDER BY si.distance_m DESC) AS dist_rank,
           dense_rank() OVER (ORDER BY COALESCE(si.moving_time_seconds, si.elapsed_time_seconds) DESC) AS dur_rank,
           dense_rank() OVER (ORDER BY (si.distance_m / NULLIF(si.moving_time_seconds, 0)) DESC) AS pace_rank
    FROM strava_imports si
    JOIN temp_logs tl ON tl.id = si.imported_to_log_id
    LEFT JOIN spots sp ON sp.id = tl.spot_id
    WHERE tl.user_id = v_uid AND si.distance_m IS NOT NULL AND si.distance_m > 0
  ),
  longest_swim AS (
    SELECT 'longest_swim' AS record_type,
      (SELECT jsonb_build_object('value', round(distance_m/1000.0, 2), 'unit', 'km', 'when', ts, 'where', spot_name)
         FROM strava_ranked WHERE dist_rank = 1 ORDER BY ts ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', round(distance_m/1000.0, 2), 'unit', 'km', 'when', ts, 'where', spot_name)
         FROM strava_ranked WHERE dist_rank = 2 ORDER BY ts ASC LIMIT 1) AS previous
  ),
  longest_duration AS (
    SELECT 'longest_duration' AS record_type,
      (SELECT jsonb_build_object('value', round(COALESCE(moving_time_seconds, elapsed_time_seconds)/60.0, 1), 'unit', 'min', 'when', ts, 'where', spot_name)
         FROM strava_ranked WHERE dur_rank = 1 AND COALESCE(moving_time_seconds, elapsed_time_seconds) IS NOT NULL ORDER BY ts ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', round(COALESCE(moving_time_seconds, elapsed_time_seconds)/60.0, 1), 'unit', 'min', 'when', ts, 'where', spot_name)
         FROM strava_ranked WHERE dur_rank = 2 AND COALESCE(moving_time_seconds, elapsed_time_seconds) IS NOT NULL ORDER BY ts ASC LIMIT 1) AS previous
  ),
  fastest_pace AS (
    SELECT 'fastest_pace' AS record_type,
      (SELECT jsonb_build_object('value', round((1000.0 / (distance_m / NULLIF(moving_time_seconds,0))) / 60.0, 2), 'unit', 'min/km', 'when', ts, 'where', spot_name)
         FROM strava_ranked WHERE pace_rank = 1 AND moving_time_seconds IS NOT NULL AND moving_time_seconds > 0 ORDER BY ts ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', round((1000.0 / (distance_m / NULLIF(moving_time_seconds,0))) / 60.0, 2), 'unit', 'min/km', 'when', ts, 'where', spot_name)
         FROM strava_ranked WHERE pace_rank = 2 AND moving_time_seconds IS NOT NULL AND moving_time_seconds > 0 ORDER BY ts ASC LIMIT 1) AS previous
  ),
  -- Most northern / southern: latitude used only as a sort key, never
  -- returned. spots.latitude preferred (named location); temp_logs.lat
  -- (GPS-tagged manual logs) used only when no spot is linked.
  geo_ranked AS (
    SELECT tl.id AS temp_log_id, COALESCE(sp.latitude, tl.lat) AS lat, COALESCE(tl.logged_at, tl.created_at) AS ts, sp.name AS spot_name,
           dense_rank() OVER (ORDER BY COALESCE(sp.latitude, tl.lat) DESC) AS north_rank,
           dense_rank() OVER (ORDER BY COALESCE(sp.latitude, tl.lat) ASC)  AS south_rank
    FROM temp_logs tl LEFT JOIN spots sp ON sp.id = tl.spot_id
    WHERE tl.user_id = v_uid AND COALESCE(sp.latitude, tl.lat) IS NOT NULL
  ),
  most_northern AS (
    SELECT 'most_northern' AS record_type,
      (SELECT jsonb_build_object('value', null, 'unit', null, 'when', ts, 'where', spot_name) FROM geo_ranked WHERE north_rank=1 ORDER BY ts ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', null, 'unit', null, 'when', ts, 'where', spot_name) FROM geo_ranked WHERE north_rank=2 ORDER BY ts ASC LIMIT 1) AS previous
  ),
  most_southern AS (
    SELECT 'most_southern' AS record_type,
      (SELECT jsonb_build_object('value', null, 'unit', null, 'when', ts, 'where', spot_name) FROM geo_ranked WHERE south_rank=1 ORDER BY ts ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', null, 'unit', null, 'when', ts, 'where', spot_name) FROM geo_ranked WHERE south_rank=2 ORDER BY ts ASC LIMIT 1) AS previous
  ),
  -- Most consecutive days: gaps-and-islands over distinct SAST log dates,
  -- recomputed fresh every call — see migration header for why this does
  -- NOT read user_stats.longest_streak.
  log_dates AS (
    SELECT DISTINCT (COALESCE(logged_at, created_at) AT TIME ZONE 'Africa/Johannesburg')::date AS d
    FROM temp_logs WHERE user_id = v_uid
  ),
  streak_runs AS (
    SELECT min(d) AS start_d, max(d) AS end_d, count(*) AS run_len,
           dense_rank() OVER (ORDER BY count(*) DESC) AS rnk
    FROM (SELECT d, d - (row_number() OVER (ORDER BY d))::int AS grp FROM log_dates) g
    GROUP BY grp
  ),
  most_consecutive AS (
    SELECT 'most_consecutive_days' AS record_type,
      (SELECT jsonb_build_object('value', run_len, 'unit', 'days', 'when', end_d, 'where', null) FROM streak_runs WHERE rnk=1 ORDER BY end_d ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', run_len, 'unit', 'days', 'when', end_d, 'where', null) FROM streak_runs WHERE rnk=2 ORDER BY end_d ASC LIMIT 1) AS previous
  ),
  -- Most swims / most spots in a calendar month (SAST), all-time best month.
  month_counts AS (
    SELECT date_trunc('month', (COALESCE(logged_at, created_at) AT TIME ZONE 'Africa/Johannesburg')) AS m,
           count(*) AS swims, count(DISTINCT spot_id) AS spots,
           dense_rank() OVER (ORDER BY count(*) DESC) AS swim_rnk,
           dense_rank() OVER (ORDER BY count(DISTINCT spot_id) DESC) AS spot_rnk
    FROM temp_logs WHERE user_id = v_uid GROUP BY 1
  ),
  most_swims_month AS (
    SELECT 'most_swims_month' AS record_type,
      (SELECT jsonb_build_object('value', swims, 'unit', 'swims', 'when', m, 'where', null) FROM month_counts WHERE swim_rnk=1 ORDER BY m ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', swims, 'unit', 'swims', 'when', m, 'where', null) FROM month_counts WHERE swim_rnk=2 ORDER BY m ASC LIMIT 1) AS previous
  ),
  most_spots_month AS (
    SELECT 'most_spots_month' AS record_type,
      (SELECT jsonb_build_object('value', spots, 'unit', 'spots', 'when', m, 'where', null) FROM month_counts WHERE spot_rnk=1 ORDER BY m ASC LIMIT 1) AS current,
      (SELECT jsonb_build_object('value', spots, 'unit', 'spots', 'when', m, 'where', null) FROM month_counts WHERE spot_rnk=2 ORDER BY m ASC LIMIT 1) AS previous
  )
  SELECT jsonb_agg(jsonb_build_object('record_type', record_type, 'current', current, 'previous', previous))
  INTO v_records
  FROM (
    SELECT * FROM coldest UNION ALL SELECT * FROM warmest
    UNION ALL SELECT * FROM longest_swim UNION ALL SELECT * FROM longest_duration UNION ALL SELECT * FROM fastest_pace
    UNION ALL SELECT * FROM most_northern UNION ALL SELECT * FROM most_southern
    UNION ALL SELECT * FROM most_consecutive
    UNION ALL SELECT * FROM most_swims_month UNION ALL SELECT * FROM most_spots_month
  ) x;

  RETURN COALESCE(v_records, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_my_records_v1() IS
  'Personal Records V1 — Dave, Carina, and Johan only. Computes current + previous best-ever '
  'for 10 record types on demand from temp_logs/strava_imports/'
  'swimmer_story_events. No new table, no generation trigger, no '
  'backfill. Never returns raw latitude/longitude. Separate from Story '
  'and Identity by design.';

REVOKE ALL ON FUNCTION public.get_my_records_v1() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_records_v1() TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.get_my_records_v1();
-- DROP FUNCTION IF EXISTS public.records_v1_flag_enabled(uuid);
-- DELETE FROM feature_flags WHERE key = 'records_v1';
-- COMMIT;
-- Does NOT alter temp_logs, strava_imports, user_stats, swimmer_story_events,
-- swimmer_achievements, identity tables, badges, challenges, or public_profiles.

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key='records_v1';
--   -- expect: 1 row, false, {Dave, Carina, Johan}
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('get_my_records_v1','records_v1_flag_enabled');  -- expect: 2 rows
