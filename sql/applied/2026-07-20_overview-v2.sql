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
-- Migration: 2026-07-20_overview-v2.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Release 2.4 — My Swimming Overview. Additive-only: overview_v2
--   feature flag (Dave, Johan "tunnan", Carina — off globally) and one
--   consolidated read RPC, get_my_swimming_overview_v1(), replacing what
--   would otherwise be 4-6 separate round trips (total swims, spots
--   explored, average temp, current-month aggregates, milestone calc)
--   with one grouped read over temp_logs + user_stats. Does not touch
--   swimmer_achievements (Identity section keeps its existing, separate
--   query — different table, different concern, same architectural
--   separation this project has held since Phase 2.1), story tables, or
--   any generation logic.
--
--   ELIMINATES a real pre-existing inefficiency, not introduced by this
--   migration but fixed by not repeating it: the current Overview
--   fetches a swimmer's ENTIRE temp_logs history client-side (just
--   `logged_at, created_at`, no limit) whenever their tier is exactly
--   'regular', purely to bucket dates into ISO weeks in JavaScript. This
--   RPC's total_swims/spots_explored/avg_temp_c/current_month/
--   next_milestone are all computed server-side instead — no full-table
--   fetch, no client-side date bucketing, for the new sections.
--
--   NEXT MILESTONE uses the REAL threshold arrays already defined in
--   evaluate_swim_story_events_internal_v1 (swim_count: 10/25/50/100/
--   250/500/1000; spots_explored: 5/10/25/50/100; streak: 7/14/30/50/
--   100) — NOT the example numbers in the Release 2.4 brief (125/250/
--   500 swims; 35/50 spots), which don't correspond to any threshold the
--   Story Engine actually fires on. Using invented numbers here would
--   create a second, inconsistent definition of "milestone" a swimmer
--   could reach with zero Story Card ever appearing for it. Flagged
--   explicitly in the Phase 2.4 review package; this migration
--   implements the corrected version.

-- Requested by:
--   Dave (SwimLoading Release 2.4 kickoff, 2026-07-20)

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM feature_flags WHERE key='overview_v2';  -- expect: 0
-- SELECT count(*) FROM pg_proc WHERE proname IN
--   ('get_my_swimming_overview_v1','overview_v2_flag_enabled');  -- expect: 0

-- ----------------------------------------------------------------
-- BACKUP — not required, additive only (one flag row, two functions, grants).
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
VALUES ('overview_v2', false, ARRAY[
  'df137255-3add-4153-b368-32e06e2be188',
  'cff2fc33-4a55-451b-8c7f-20f12c1898ce',
  'becb6930-c952-46b0-ae03-741a0721004d'
]::uuid[])
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.overview_v2_flag_enabled(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled_global OR p_user = ANY(allowed_user_ids)
       FROM feature_flags WHERE key = 'overview_v2'),
    false);
$$;

REVOKE ALL ON FUNCTION public.overview_v2_flag_enabled(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.overview_v2_flag_enabled(uuid) TO authenticated;

-- ── 2. get_my_swimming_overview_v1 ───────────────────────────────
-- SECURITY INVOKER — auth.uid()-scoped reads only, no bypass needed.
CREATE OR REPLACE FUNCTION public.get_my_swimming_overview_v1()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total_swims int;
  v_streak int;
  v_spots int;
  v_avg_temp numeric;
  v_month_swims int;
  v_month_avg numeric;
  v_month_coldest numeric;
  v_month_warmest numeric;
  v_next jsonb;
  v_latest_story jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT overview_v2_flag_enabled(v_uid) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), count(DISTINCT spot_id), round(avg(temp_c), 1)
    INTO v_total_swims, v_spots, v_avg_temp
    FROM temp_logs WHERE user_id = v_uid;

  SELECT current_streak INTO v_streak FROM user_stats WHERE user_id = v_uid;
  v_streak := COALESCE(v_streak, 0);

  -- SAST calendar month, matching this project's established timezone
  -- convention for anything month-boundary-sensitive.
  SELECT count(*), round(avg(temp_c), 1), min(temp_c), max(temp_c)
    INTO v_month_swims, v_month_avg, v_month_coldest, v_month_warmest
    FROM temp_logs
    WHERE user_id = v_uid
      AND date_trunc('month', (COALESCE(logged_at, created_at) AT TIME ZONE 'Africa/Johannesburg'))
          = date_trunc('month', (now() AT TIME ZONE 'Africa/Johannesburg'));

  -- Next milestone: real Story Engine thresholds only (see migration
  -- header). Whichever candidate needs the fewest additional swims wins;
  -- ties broken by CATEGORY PRIORITY — swim count, then exploration, then
  -- streak. Swim count is the metric every swimmer moves simply by
  -- swimming, so at equal remaining-count it is the one they are most
  -- certain to actually reach; a streak target is the most fragile and
  -- ranks last. (Deliberately NOT "smallest target wins" — that would let
  -- an unrelated category jump the queue on an arithmetic coincidence.)
  WITH candidates AS (
    SELECT 'swim_count' AS type, 1 AS category_priority,
           t AS target, t - v_total_swims AS remaining
      FROM unnest(ARRAY[10,25,50,100,250,500,1000]) AS t WHERE t > v_total_swims
    UNION ALL
    SELECT 'spots_explored', 2, t, t - v_spots
      FROM unnest(ARRAY[5,10,25,50,100]) AS t WHERE t > v_spots
    UNION ALL
    SELECT 'streak', 3, t, t - v_streak
      FROM unnest(ARRAY[7,14,30,50,100]) AS t WHERE t > v_streak
  )
  SELECT jsonb_build_object(
    'type', type, 'target', target, 'remaining', remaining,
    'progress', round((target - remaining)::numeric / target, 3)
  ) INTO v_next
  FROM candidates ORDER BY remaining ASC, category_priority ASC LIMIT 1;

  -- Latest story: queried directly here so the client makes ONE round
  -- trip for the whole Overview. Deliberately a narrow field list — no
  -- user_id / temp_log_id / dedupe_key / metadata / coordinates. Spot is
  -- exposed by NAME only, never lat/lng (established rule for every RPC
  -- in this release).
  SELECT jsonb_build_object(
           'id', sse.id, 'story_type', sse.story_type, 'story_date', sse.story_date,
           'title', sse.title, 'summary', sse.summary,
           'primary_value', sse.primary_value, 'unit', sse.unit,
           'spot_name', sp.name
         )
    INTO v_latest_story
    FROM swimmer_story_events sse
    LEFT JOIN spots sp ON sp.id = sse.spot_id
   WHERE sse.user_id = v_uid
   ORDER BY sse.story_date DESC, sse.created_at DESC, sse.id DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'total_swims', v_total_swims,
    'current_streak', v_streak,
    'spots_explored', v_spots,
    'avg_temp_c', v_avg_temp,
    'current_month', jsonb_build_object(
      'swims', COALESCE(v_month_swims, 0),
      'avg_temp_c', v_month_avg,
      'coldest', v_month_coldest,
      'warmest', v_month_warmest
    ),
    'next_milestone', v_next,
    'latest_story', v_latest_story
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_swimming_overview_v1() IS
  'Release 2.4 — one consolidated read of the authenticated caller''s own '
  'swim statistics for the Overview dashboard, including latest_story so '
  'the client needs no second call. next_milestone uses the real Story '
  'Engine threshold arrays, not invented numbers. No writes, '
  'no milestone generation — see evaluate_swim_story_events_v1 for that.';

REVOKE ALL ON FUNCTION public.get_my_swimming_overview_v1() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_swimming_overview_v1() TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.get_my_swimming_overview_v1();
-- DROP FUNCTION IF EXISTS public.overview_v2_flag_enabled(uuid);
-- DELETE FROM feature_flags WHERE key = 'overview_v2';
-- COMMIT;
-- Does NOT alter temp_logs, user_stats, swimmer_achievements, story
-- tables, identity tables, badges, challenges, Strava tables, or
-- public_profiles.

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key='overview_v2';
--   -- expect: 1 row, false, {Dave, Carina, Johan}
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('get_my_swimming_overview_v1','overview_v2_flag_enabled');  -- expect: 2 rows
