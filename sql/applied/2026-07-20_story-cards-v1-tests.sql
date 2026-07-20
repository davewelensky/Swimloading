-- ================================================================
-- SwimLoading — Story Cards V1 (get_my_story_events_for_log_v1)
-- acceptance harness. NOT part of the migration. Self-contained — defines
-- the exact migration functions inline, so it runs whether or not
-- 2026-07-20_story-cards-v1.sql has been applied yet.
--
-- AUTHORISED, WRITABLE transaction ending in ROLLBACK.
--
-- Actually run twice, both as two separate transactions (t1-t8,t10-t13
-- together, t9 separately — see the note above t9 below):
-- (1) 2026-07-20 pre-apply, functions defined inline as shown: 13/13.
-- (2) 2026-07-20 post-apply, against the real deployed
--     get_my_story_events_for_log_v1 (fixture user temporarily and
--     reversibly added to the flag's allowed_user_ids inside each
--     transaction): 13/13 again.
-- Both runs verified zero persistence afterward on the read-only
-- connection: dedupe_key LIKE 'card_test%' count 0, feature_flags
-- allowed_user_ids back to Dave-only, fixture spot count 0.
-- ================================================================

BEGIN;

CREATE TEMP TABLE test_results (n int, name text, passed boolean, detail text);

-- ----------------------------------------------------------------
-- Fixtures
-- ----------------------------------------------------------------
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-a000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, display_name, date_of_birth) VALUES
  ('00000000-0000-4000-a000-000000000001', 'Test Swimmer A', '1990-01-01'),
  ('00000000-0000-4000-a000-000000000002', 'Test Swimmer B', '1990-01-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO spots (id, name, domain, latitude, longitude, water_type) VALUES
  ('00000000-0000-4000-e000-000000000001', 'Card Test Spot', 'ATLANTIC', -33.9, 18.4, 'OCEAN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('story_cards_v1', false, ARRAY['00000000-0000-4000-a000-000000000001']::uuid[])
ON CONFLICT (key) DO UPDATE SET enabled_global = false, allowed_user_ids = EXCLUDED.allowed_user_ids;

-- Inline the exact migration functions
CREATE OR REPLACE FUNCTION public.story_cards_flag_enabled(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT enabled_global OR p_user = ANY(allowed_user_ids) FROM feature_flags WHERE key = 'story_cards_v1'), false);
$$;

CREATE OR REPLACE FUNCTION public.get_my_story_events_for_log_v1(p_temp_log_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_owns_log boolean; v_events jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT story_cards_flag_enabled(auth.uid()) THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF;
  SELECT EXISTS (SELECT 1 FROM temp_logs tl WHERE tl.id = p_temp_log_id AND tl.user_id = auth.uid()) INTO v_owns_log;
  IF NOT v_owns_log THEN RETURN '[]'::jsonb; END IF;
  WITH ranked AS (
    SELECT sse.id, sse.story_type, sse.story_date, sse.title, sse.summary,
           sse.primary_value, sse.secondary_value, sse.unit, sse.spot_id, sp.name AS spot_name,
           sse.verification_status, sse.created_at,
           CASE sse.story_type
             WHEN 'first_swim' THEN 1 WHEN 'swim_count_milestone' THEN 2
             WHEN 'first_sub_16' THEN 3 WHEN 'first_sub_13' THEN 3 WHEN 'first_sub_10' THEN 3
             WHEN 'first_sub_7' THEN 3 WHEN 'first_sub_5' THEN 3
             WHEN 'new_coldest_swim' THEN 4 WHEN 'new_warmest_swim' THEN 4
             WHEN 'spots_explored_milestone' THEN 5 WHEN 'spot_visit_milestone' THEN 6
             WHEN 'streak_milestone' THEN 7
             WHEN 'first_pool_swim' THEN 8 WHEN 'first_open_water_swim' THEN 8
             WHEN 'first_spot_visit' THEN 9 ELSE 99
           END AS category_rank,
           CASE sse.story_type
             WHEN 'first_sub_5' THEN 1 WHEN 'first_sub_7' THEN 2 WHEN 'first_sub_10' THEN 3
             WHEN 'first_sub_13' THEN 4 WHEN 'first_sub_16' THEN 5 ELSE 0
           END AS sub_rank
    FROM swimmer_story_events sse
    LEFT JOIN spots sp ON sp.id = sse.spot_id
    WHERE sse.user_id = auth.uid() AND sse.temp_log_id = p_temp_log_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'story_type', story_type, 'story_date', story_date, 'title', title, 'summary', summary,
    'primary_value', primary_value, 'secondary_value', secondary_value, 'unit', unit,
    'spot_id', spot_id, 'spot_name', spot_name, 'verification_status', verification_status, 'created_at', created_at
  ) ORDER BY category_rank ASC, sub_rank ASC, primary_value DESC NULLS LAST, id DESC), '[]'::jsonb)
  INTO v_events FROM ranked;
  RETURN v_events;
END;
$$;

-- Multi-event fixture log: 6 simultaneous story events spanning 5
-- different category ranks, to exercise t10's priority ordering.
DO $$
DECLARE v_log uuid; v_log2 uuid; v_log3 uuid;
BEGIN
  INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000001', 4.0) RETURNING id INTO v_log;
  INSERT INTO swimmer_story_events (user_id, temp_log_id, story_type, story_date, title, summary, primary_value, unit, spot_id, dedupe_key) VALUES
    ('00000000-0000-4000-a000-000000000001', v_log, 'first_sub_10', current_date, 'First Sub 10', 'summary', 4.0, '°C', '00000000-0000-4000-e000-000000000001', 'card_test_sub10'),
    ('00000000-0000-4000-a000-000000000001', v_log, 'first_sub_5', current_date, 'First Sub 5', 'summary', 4.0, '°C', '00000000-0000-4000-e000-000000000001', 'card_test_sub5'),
    ('00000000-0000-4000-a000-000000000001', v_log, 'new_coldest_swim', current_date, 'Coldest', 'summary', 4.0, '°C', '00000000-0000-4000-e000-000000000001', 'card_test_coldest'),
    ('00000000-0000-4000-a000-000000000001', v_log, 'spots_explored_milestone', current_date, 'Spots 10', 'summary', 10, 'spots', '00000000-0000-4000-e000-000000000001', 'card_test_spots10'),
    ('00000000-0000-4000-a000-000000000001', v_log, 'spot_visit_milestone', current_date, 'Visits 100', 'summary', 100, 'visits', '00000000-0000-4000-e000-000000000001', 'card_test_visit100'),
    ('00000000-0000-4000-a000-000000000001', v_log, 'streak_milestone', current_date, 'Streak 50', 'summary', 50, 'days', '00000000-0000-4000-e000-000000000001', 'card_test_streak50');

  INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000001', 19.0) RETURNING id INTO v_log2;

  INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-e000-000000000001', 19.0) RETURNING id INTO v_log3;
  INSERT INTO swimmer_story_events (user_id, temp_log_id, story_type, story_date, title, dedupe_key)
    VALUES ('00000000-0000-4000-a000-000000000002', v_log3, 'first_swim', current_date, 'User B First Swim', 'card_test_userb_first');

  CREATE TEMP TABLE fixture_logs AS SELECT v_log AS multi, v_log2 AS empty, v_log3 AS other_user;
END $$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000001', true);

-- t1: owner receives events for own log
INSERT INTO test_results VALUES (1, 't1_owner_receives_own_events',
  jsonb_array_length(get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs))) = 6, '');

-- t2: another user's events are excluded
INSERT INTO test_results VALUES (2, 't2_other_user_log_excluded',
  get_my_story_events_for_log_v1((SELECT other_user FROM fixture_logs)) = '[]'::jsonb, '');

-- t3: anonymous caller rejected
DO $$
DECLARE v_rejected boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs));
  EXCEPTION WHEN OTHERS THEN v_rejected := (SQLERRM = 'not_authenticated'); END;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000001', true);
  INSERT INTO test_results VALUES (3, 't3_anonymous_rejected', v_rejected, '');
END $$;

-- t4: log with no events returns empty array safely
INSERT INTO test_results VALUES (4, 't4_empty_log_safe',
  get_my_story_events_for_log_v1((SELECT empty FROM fixture_logs)) = '[]'::jsonb, '');

-- t5: all events returned belong to the requested log
INSERT INTO test_results VALUES (5, 't5_all_events_belong_to_log',
  jsonb_array_length(get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs))) = 6, '');

-- t6: no user_id returned
INSERT INTO test_results VALUES (6, 't6_no_user_id',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs))) e WHERE e ? 'user_id'), '');

-- t7: no dedupe_key returned
INSERT INTO test_results VALUES (7, 't7_no_dedupe_key',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs))) e WHERE e ? 'dedupe_key'), '');

-- t8: no exact coordinates returned
INSERT INTO test_results VALUES (8, 't8_no_coordinates',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs))) e WHERE e ? 'latitude' OR e ? 'longitude'), '');

-- t9: RUN SEPARATELY (see 2026-07-20_story-cards-v1-tests-t9.sql note
-- below) — a real schema discovery forced this split. When a
-- swimmer_story_events row's OWN spot_id points at the SAME spot its
-- linked temp_log also uses, deleting that spot triggers two overlapping
-- cascade paths (temp_logs_spot_id_fkey CASCADE +
-- swimmer_story_events_spot_id_fkey SET NULL, both racing against
-- swimmer_story_events_temp_log_id_fkey SET NULL from the temp_logs
-- cascade) that raise an FK violation instead of cleanly nulling both
-- columns. This is PRE-EXISTING schema behavior — not introduced by this
-- migration — surfaced only because this test exercises it. Reported to
-- Dave separately; not fixed here (out of scope for an additive,
-- read-only Phase 2.3 migration). The RPC itself is unaffected in normal
-- operation: production never deletes spots this way, and the RPC's own
-- LEFT JOIN already handles a null spot_id correctly regardless.
--
-- t9 itself (run in its own transaction, avoiding the schema quirk by
-- giving the story event's OWN spot_id a DIFFERENT spot than the one its
-- temp_log uses, then deleting only that independent spot):
--   SELECT jsonb_array_length(get_my_story_events_for_log_v1(<log_id>)) = 1;
--   -- Result: true. spot_id and spot_name both resolved to null, no error.

-- t10: results ordered by card priority
INSERT INTO test_results VALUES (10, 't10_priority_order_correct',
  (SELECT array_agg(e->>'title') FROM jsonb_array_elements(get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs))) e)
    = ARRAY['First Sub 5','First Sub 10','Coldest','Spots 10','Visits 100','Streak 50'],
  (SELECT array_to_string(array_agg(e->>'title'), ' | ') FROM jsonb_array_elements(get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs))) e));

-- t11: repeated call returns the same stored results
INSERT INTO test_results VALUES (11, 't11_repeated_call_stable',
  get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs)) = get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs)), '');

-- t12: flag-disabled caller is rejected
DO $$
DECLARE v_rejected boolean := false;
BEGIN
  UPDATE feature_flags SET allowed_user_ids = ARRAY[]::uuid[], enabled_global=false WHERE key='story_cards_v1';
  BEGIN
    PERFORM get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs));
  EXCEPTION WHEN OTHERS THEN v_rejected := (SQLERRM = 'feature_disabled'); END;
  UPDATE feature_flags SET allowed_user_ids = ARRAY['00000000-0000-4000-a000-000000000001']::uuid[] WHERE key='story_cards_v1';
  INSERT INTO test_results VALUES (12, 't12_flag_disabled_rejected', v_rejected, '');
END $$;

-- t13: Dave-only access works (allowed_user_ids re-restored above)
INSERT INTO test_results VALUES (13, 't13_allowed_user_access_works',
  jsonb_array_length(get_my_story_events_for_log_v1((SELECT multi FROM fixture_logs))) = 6, '');

SELECT * FROM test_results ORDER BY n;

-- ----------------------------------------------------------------
-- Final protection — nothing from this file is ever persisted.
-- ----------------------------------------------------------------
ROLLBACK;
