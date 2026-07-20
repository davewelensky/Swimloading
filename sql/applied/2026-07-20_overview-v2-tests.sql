-- ================================================================
-- SwimLoading — Overview V2 (get_my_swimming_overview_v1) acceptance
-- harness. NOT part of the migration. Self-contained: it defines the
-- exact migration functions inline first, so it can be run BEFORE the
-- migration is applied (pre-apply validation) and again afterwards
-- against the deployed functions (delete the inline CREATE block).
--
-- Run 2026-07-20, PRE-APPLY, functions defined inline: 18/18 passed.
-- Zero persistence confirmed afterwards on the read-only connection:
-- test users 0, test spots 0, test_ov_% stories 0, overview_v2 flag rows
-- 0, both functions absent — the transaction never committed.
--
-- AUTHORISED, WRITABLE transaction ending in ROLLBACK. Single flat
-- BEGIN...ROLLBACK, no nested SAVEPOINTs — the RPC is read-only, and a
-- SAVEPOINT rollback would discard the test_results bookkeeping too.
--
-- Fixture note: temp_logs.logged_at carries a 48-hour no-backdating
-- trigger, so historical fixtures leave logged_at NULL and backdate
-- created_at directly (the RPC reads COALESCE(logged_at, created_at)).
-- ================================================================

BEGIN;

CREATE TEMP TABLE test_results (n int, name text, passed boolean, detail text);

-- ----------------------------------------------------------------
-- Fixtures
-- ----------------------------------------------------------------
-- A = tie-break "swim_count beats spots_explored" + month/avg maths
-- B = other swimmer, must never leak into A's numbers
-- C = tie-break "spots_explored beats streak"
-- D = brand-new swimmer, zero of everything
-- E = everything maxed out, no milestone left
-- F = one spot-less story event, no logs
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-b000-00000000000a'),
  ('00000000-0000-4000-b000-00000000000b'),
  ('00000000-0000-4000-b000-00000000000c'),
  ('00000000-0000-4000-b000-00000000000d'),
  ('00000000-0000-4000-b000-00000000000e'),
  ('00000000-0000-4000-b000-00000000000f')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, display_name, date_of_birth)
SELECT id, 'Overview Test ' || right(id::text, 1), DATE '1990-01-01'
FROM auth.users WHERE id::text LIKE '00000000-0000-4000-b000-%'
ON CONFLICT (id) DO NOTHING;

-- 100 fixture spots (E needs 100 distinct; A/C use the first few)
INSERT INTO spots (id, name, domain, latitude, longitude, water_type)
SELECT ('00000000-0000-4000-e000-' || lpad(i::text, 12, '0'))::uuid,
       'Overview Test Spot ' || i, 'ATLANTIC', -33.9, 18.4, 'OCEAN'
FROM generate_series(1, 100) i
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('overview_v2', false, ARRAY[
  '00000000-0000-4000-b000-00000000000a',
  '00000000-0000-4000-b000-00000000000c',
  '00000000-0000-4000-b000-00000000000d',
  '00000000-0000-4000-b000-00000000000e',
  '00000000-0000-4000-b000-00000000000f'
]::uuid[])
ON CONFLICT (key) DO UPDATE
  SET enabled_global = false, allowed_user_ids = EXCLUDED.allowed_user_ids;
-- NOTE: B is deliberately NOT allow-listed (feature_disabled scenario).

-- ── Inline the exact migration functions ─────────────────────────
CREATE OR REPLACE FUNCTION public.overview_v2_flag_enabled(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT enabled_global OR p_user = ANY(allowed_user_ids)
       FROM feature_flags WHERE key = 'overview_v2'),
    false);
$$;

CREATE OR REPLACE FUNCTION public.get_my_swimming_overview_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total_swims int; v_streak int; v_spots int; v_avg_temp numeric;
  v_month_swims int; v_month_avg numeric; v_month_coldest numeric; v_month_warmest numeric;
  v_next jsonb; v_latest_story jsonb;
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

  SELECT count(*), round(avg(temp_c), 1), min(temp_c), max(temp_c)
    INTO v_month_swims, v_month_avg, v_month_coldest, v_month_warmest
    FROM temp_logs
    WHERE user_id = v_uid
      AND date_trunc('month', (COALESCE(logged_at, created_at) AT TIME ZONE 'Africa/Johannesburg'))
          = date_trunc('month', (now() AT TIME ZONE 'Africa/Johannesburg'));

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

-- ── Swimmer A: 9 logs over 4 distinct spots ──────────────────────
-- swim_count next target 10 (remaining 1); spots next target 5
-- (remaining 1) → exact tie, category priority must pick swim_count.
-- 6 logs this SAST month (temps 10,11,12,13,14,15 → avg 12.5, min 10,
-- max 15); 3 logs last month, which must be excluded from current_month
-- but counted in total_swims/avg_temp_c.
INSERT INTO temp_logs (user_id, spot_id, temp_c, created_at, logged_at, location_source)
SELECT '00000000-0000-4000-b000-00000000000a',
       ('00000000-0000-4000-e000-' || lpad((1 + (i % 4))::text, 12, '0'))::uuid,
       9 + i,
       date_trunc('month', now() AT TIME ZONE 'Africa/Johannesburg') + interval '5 days' + (i * interval '1 hour'),
       NULL, 'manual'
FROM generate_series(1, 6) i;

INSERT INTO temp_logs (user_id, spot_id, temp_c, created_at, logged_at, location_source)
SELECT '00000000-0000-4000-b000-00000000000a',
       '00000000-0000-4000-e000-000000000001'::uuid,
       20, date_trunc('month', now() AT TIME ZONE 'Africa/Johannesburg') - interval '10 days' + (i * interval '1 hour'),
       NULL, 'manual'
FROM generate_series(1, 3) i;
-- A total: 9 logs, 4 distinct spots, avg = (10+11+12+13+14+15+20*3)/9 = 15.0

-- A's stories: newest by story_date, then created_at, then id.
INSERT INTO swimmer_story_events (id, user_id, story_type, story_date, created_at, title, summary, primary_value, unit, spot_id, dedupe_key) VALUES
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-00000000000a', 'first_swim',           DATE '2026-07-10', TIMESTAMPTZ '2026-07-10 08:00:00+00', 'Older Date',        'older',      1,  NULL,  '00000000-0000-4000-e000-000000000001', 'test_ov_a_1'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-00000000000a', 'swim_count_milestone', DATE '2026-07-15', TIMESTAMPTZ '2026-07-15 08:00:00+00', 'Same Date Earlier', 'earlier',    10, 'swims', '00000000-0000-4000-e000-000000000001', 'test_ov_a_2'),
  ('00000000-0000-4000-c000-00000000000e', '00000000-0000-4000-b000-00000000000a', 'new_coldest_swim',     DATE '2026-07-15', TIMESTAMPTZ '2026-07-15 09:00:00+00', 'Loses On Id',       'lower id',   9,  'C',   '00000000-0000-4000-e000-000000000002', 'test_ov_a_3'),
  ('00000000-0000-4000-c000-00000000000f', '00000000-0000-4000-b000-00000000000a', 'new_warmest_swim',     DATE '2026-07-15', TIMESTAMPTZ '2026-07-15 09:00:00+00', 'Expected Latest',   'the winner', 21, 'C',   '00000000-0000-4000-e000-000000000002', 'test_ov_a_4');

-- ── Swimmer B: cross-user noise, NOT allow-listed ────────────────
INSERT INTO temp_logs (user_id, spot_id, temp_c, created_at, logged_at, location_source)
SELECT '00000000-0000-4000-b000-00000000000b',
       ('00000000-0000-4000-e000-' || lpad((10 + i)::text, 12, '0'))::uuid,
       5, now() - (i * interval '1 hour'), NULL, 'manual'
FROM generate_series(1, 40) i;

INSERT INTO swimmer_story_events (user_id, story_type, story_date, created_at, title, dedupe_key)
VALUES ('00000000-0000-4000-b000-00000000000b', 'first_swim', DATE '2099-01-01', now(), 'User B Event', 'test_ov_b_1');

-- ── Swimmer C: 10 logs, 4 spots, streak 6 ────────────────────────
-- swim_count remaining 15 (→25); spots remaining 1 (→5); streak
-- remaining 1 (→7). spots vs streak tie → spots_explored must win.
INSERT INTO temp_logs (user_id, spot_id, temp_c, created_at, logged_at, location_source)
SELECT '00000000-0000-4000-b000-00000000000c',
       ('00000000-0000-4000-e000-' || lpad((1 + (i % 4))::text, 12, '0'))::uuid,
       14, now() - (i * interval '1 hour'), NULL, 'manual'
FROM generate_series(1, 10) i;

INSERT INTO user_stats (user_id, current_streak)
VALUES ('00000000-0000-4000-b000-00000000000c', 6)
ON CONFLICT (user_id) DO UPDATE SET current_streak = 6;

-- ── Swimmer D: nothing at all (no logs, no stats row, no stories) ─

-- ── Swimmer E: every threshold already passed ────────────────────
INSERT INTO temp_logs (user_id, spot_id, temp_c, created_at, logged_at, location_source)
SELECT '00000000-0000-4000-b000-00000000000e',
       ('00000000-0000-4000-e000-' || lpad((1 + (i % 100))::text, 12, '0'))::uuid,
       16, now() - (i * interval '1 minute'), NULL, 'manual'
FROM generate_series(1, 1000) i;

INSERT INTO user_stats (user_id, current_streak)
VALUES ('00000000-0000-4000-b000-00000000000e', 100)
ON CONFLICT (user_id) DO UPDATE SET current_streak = 100;

-- ── Swimmer F: one spot-less story event, no logs ────────────────
INSERT INTO swimmer_story_events (user_id, story_type, story_date, created_at, title, spot_id, dedupe_key)
VALUES ('00000000-0000-4000-b000-00000000000f', 'streak_milestone', DATE '2026-07-01', now(), 'Spotless', NULL, 'test_ov_f_1');

-- ----------------------------------------------------------------
-- SCENARIOS
-- ----------------------------------------------------------------

-- t1: unauthenticated caller is rejected
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM get_my_swimming_overview_v1();
    INSERT INTO test_results VALUES (1, 't1_unauthenticated_rejected', false, 'no exception raised');
  EXCEPTION WHEN sqlstate '28000' THEN
    INSERT INTO test_results VALUES (1, 't1_unauthenticated_rejected', true, 'SQLSTATE 28000');
  WHEN OTHERS THEN
    INSERT INTO test_results VALUES (1, 't1_unauthenticated_rejected', false, 'wrong error: ' || SQLERRM);
  END;
END $$;

-- t2: authenticated but NOT allow-listed is rejected (feature_disabled)
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-00000000000b', true);
  BEGIN
    PERFORM get_my_swimming_overview_v1();
    INSERT INTO test_results VALUES (2, 't2_flag_off_rejected', false, 'no exception raised');
  EXCEPTION WHEN sqlstate '42501' THEN
    INSERT INTO test_results VALUES (2, 't2_flag_off_rejected', true, 'SQLSTATE 42501');
  WHEN OTHERS THEN
    INSERT INTO test_results VALUES (2, 't2_flag_off_rejected', false, 'wrong error: ' || SQLERRM);
  END;
END $$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-00000000000a', true);

-- t3: total_swims counts only the caller's own logs
INSERT INTO test_results
SELECT 3, 't3_total_swims_own_only',
       (get_my_swimming_overview_v1() ->> 'total_swims') = '9',
       'got ' || (get_my_swimming_overview_v1() ->> 'total_swims') || ' expected 9';

-- t4: spots_explored is a DISTINCT count
INSERT INTO test_results
SELECT 4, 't4_spots_explored_distinct',
       (get_my_swimming_overview_v1() ->> 'spots_explored') = '4',
       'got ' || (get_my_swimming_overview_v1() ->> 'spots_explored') || ' expected 4';

-- t5: avg_temp_c is all-time and rounded to 1dp
INSERT INTO test_results
SELECT 5, 't5_avg_temp_all_time_1dp',
       (get_my_swimming_overview_v1() ->> 'avg_temp_c')::numeric = 15.0,
       'got ' || (get_my_swimming_overview_v1() ->> 'avg_temp_c') || ' expected 15.0';

-- t6: current_month excludes last month's logs (SAST boundary)
INSERT INTO test_results
SELECT 6, 't6_current_month_swims_scoped',
       (get_my_swimming_overview_v1() -> 'current_month' ->> 'swims') = '6',
       'got ' || (get_my_swimming_overview_v1() -> 'current_month' ->> 'swims') || ' expected 6';

-- t7: current_month avg / coldest / warmest are month-scoped too
INSERT INTO test_results
SELECT 7, 't7_current_month_temps',
       (m ->> 'avg_temp_c')::numeric = 12.5 AND (m ->> 'coldest')::numeric = 10 AND (m ->> 'warmest')::numeric = 15,
       'avg=' || (m ->> 'avg_temp_c') || ' coldest=' || (m ->> 'coldest') || ' warmest=' || (m ->> 'warmest')
FROM (SELECT get_my_swimming_overview_v1() -> 'current_month' AS m) q;

-- t8: current_streak is read from user_stats, not recomputed.
-- (Originally asserted 0 here — wrong fixture assumption: inserting
-- temp_logs fires the stats trigger, so A DOES have a user_stats row.
-- The missing-row → 0 path is covered by t16 and t18 instead.)
INSERT INTO test_results
SELECT 8, 't8_streak_from_user_stats',
       (get_my_swimming_overview_v1() ->> 'current_streak')::int
         = (SELECT current_streak FROM user_stats WHERE user_id = '00000000-0000-4000-b000-00000000000a'),
       'rpc=' || (get_my_swimming_overview_v1() ->> 'current_streak')
         || ' user_stats=' || COALESCE((SELECT current_streak::text FROM user_stats WHERE user_id = '00000000-0000-4000-b000-00000000000a'), 'no row');

-- t9: TIE-BREAK — swim_count beats spots_explored at equal remaining
INSERT INTO test_results
SELECT 9, 't9_tiebreak_swim_count_wins',
       (n ->> 'type') = 'swim_count' AND (n ->> 'target') = '10' AND (n ->> 'remaining') = '1',
       'got ' || n::text
FROM (SELECT get_my_swimming_overview_v1() -> 'next_milestone' AS n) q;

-- t10: milestone progress is a 0-1 fraction of the target
INSERT INTO test_results
SELECT 10, 't10_milestone_progress',
       (get_my_swimming_overview_v1() -> 'next_milestone' ->> 'progress')::numeric = 0.900,
       'got ' || (get_my_swimming_overview_v1() -> 'next_milestone' ->> 'progress') || ' expected 0.900';

-- t11: latest_story picks story_date DESC, created_at DESC, id DESC
INSERT INTO test_results
SELECT 11, 't11_latest_story_ordering',
       (get_my_swimming_overview_v1() -> 'latest_story' ->> 'title') = 'Expected Latest',
       'got ' || (get_my_swimming_overview_v1() -> 'latest_story' ->> 'title');

-- t12: latest_story exposes EXACTLY the agreed fields — no user_id,
--      temp_log_id, dedupe_key, metadata, secondary_value, coordinates
INSERT INTO test_results
SELECT 12, 't12_latest_story_field_list',
       (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(get_my_swimming_overview_v1() -> 'latest_story') k)
       = ARRAY['id','primary_value','spot_name','story_date','story_type','summary','title','unit'],
       'got ' || (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(get_my_swimming_overview_v1() -> 'latest_story') k);

-- t13: latest_story resolves spot NAME (never lat/lng)
INSERT INTO test_results
SELECT 13, 't13_latest_story_spot_name',
       (get_my_swimming_overview_v1() -> 'latest_story' ->> 'spot_name') = 'Overview Test Spot 2',
       'got ' || (get_my_swimming_overview_v1() -> 'latest_story' ->> 'spot_name');

-- t14: another swimmer's story never appears (B's is dated 2099)
INSERT INTO test_results
SELECT 14, 't14_latest_story_cross_user_isolated',
       (get_my_swimming_overview_v1() -> 'latest_story' ->> 'title') <> 'User B Event',
       'got ' || (get_my_swimming_overview_v1() -> 'latest_story' ->> 'title');

-- t15: TIE-BREAK — spots_explored beats streak at equal remaining
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-00000000000c', true);
INSERT INTO test_results
SELECT 15, 't15_tiebreak_spots_beats_streak',
       (n ->> 'type') = 'spots_explored' AND (n ->> 'target') = '5' AND (n ->> 'remaining') = '1',
       'got ' || n::text
FROM (SELECT get_my_swimming_overview_v1() -> 'next_milestone' AS n) q;

-- t16: brand-new swimmer — zeros, nulls, no story, and NO user_stats
-- row (so current_streak must COALESCE to 0, never null).
-- Milestone note: at 0/0/0 the candidates are 10 swims (remaining 10),
-- 5 spots (remaining 5) and a 7-day streak (remaining 7) — no tie, so
-- "fewest remaining" alone decides and a brand-new swimmer's first
-- milestone is 5 SPOTS, not 10 swims. Category priority only ever
-- breaks an exact tie (t9, t15). Flagged to Dave as a product call, not
-- a bug: the rule he specified produces this deliberately.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-00000000000d', true);
INSERT INTO test_results
SELECT 16, 't16_new_swimmer_empty_state',
       (r ->> 'total_swims') = '0' AND (r ->> 'spots_explored') = '0'
       AND (r ->> 'current_streak') = '0' AND r -> 'avg_temp_c' = 'null'::jsonb
       AND (r -> 'current_month' ->> 'swims') = '0'
       AND r -> 'latest_story' = 'null'::jsonb
       AND (r -> 'next_milestone' ->> 'type') = 'spots_explored'
       AND (r -> 'next_milestone' ->> 'target') = '5'
       AND (r -> 'next_milestone' ->> 'remaining') = '5'
       AND (r -> 'next_milestone' ->> 'progress')::numeric = 0,
       'got ' || r::text
FROM (SELECT get_my_swimming_overview_v1() AS r) q;

-- t17: every threshold passed → next_milestone null, not an error
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-00000000000e', true);
INSERT INTO test_results
SELECT 17, 't17_all_thresholds_passed_null_milestone',
       r -> 'next_milestone' = 'null'::jsonb
       AND (r ->> 'total_swims') = '1000' AND (r ->> 'spots_explored') = '100',
       'milestone=' || (r -> 'next_milestone')::text || ' swims=' || (r ->> 'total_swims') || ' spots=' || (r ->> 'spots_explored')
FROM (SELECT get_my_swimming_overview_v1() AS r) q;

-- t18: spot-less story event returns spot_name null, no error
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-00000000000f', true);
INSERT INTO test_results
SELECT 18, 't18_spotless_story_safe',
       r -> 'latest_story' -> 'spot_name' = 'null'::jsonb
       AND (r -> 'latest_story' ->> 'title') = 'Spotless'
       AND (r ->> 'total_swims') = '0'
       AND (r ->> 'current_streak') = '0',  -- no user_stats row → COALESCE to 0
       'got ' || (r -> 'latest_story')::text
FROM (SELECT get_my_swimming_overview_v1() AS r) q;

-- t19: the response NEVER carries an identifier or location field, at
--      any depth. Checked as raw text so a nested object cannot smuggle
--      one past a top-level key check. Run against swimmer A, whose
--      response is the fullest (stats + month + milestone + story).
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-00000000000a', true);
INSERT INTO test_results
SELECT 19, 't19_no_identifier_or_location_fields',
       t NOT LIKE '%"user_id"%' AND t NOT LIKE '%"temp_log_id"%'
       AND t NOT LIKE '%"dedupe_key"%' AND t NOT LIKE '%"metadata"%'
       AND t NOT LIKE '%"latitude"%' AND t NOT LIKE '%"longitude"%'
       AND t NOT LIKE '%"lat"%' AND t NOT LIKE '%"lng"%'
       AND t NOT LIKE '%"coordinates"%' AND t NOT LIKE '%"spot_id"%',
       'response = ' || t
FROM (SELECT get_my_swimming_overview_v1()::text AS t) q;

-- ----------------------------------------------------------------
-- Report AND unwind in one move: raising here both surfaces the results
-- (the admin SQL tool only returns the last statement's output, and a
-- trailing ROLLBACK would swallow a preceding SELECT) and guarantees the
-- transaction cannot commit, whatever happens next.
DO $$
DECLARE v_report text;
BEGIN
  SELECT string_agg(n || ' ' || name || ' :: ' || CASE WHEN passed THEN 'PASS' ELSE 'FAIL — ' || COALESCE(detail, '') END, E'\n' ORDER BY n)
    INTO v_report FROM test_results;
  RAISE EXCEPTION E'OVERVIEW V2 RESULTS (% passed / % total)\n%',
    (SELECT count(*) FROM test_results WHERE passed),
    (SELECT count(*) FROM test_results),
    v_report;
END $$;

ROLLBACK;
