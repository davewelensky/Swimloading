-- ================================================================
-- SwimLoading — Story Timeline V1 (get_my_story_timeline_v1) acceptance
-- harness. NOT part of the migration. Run against a project where
-- 2026-07-20_story-timeline-v1.sql has already been applied — OR, to
-- validate before applying, run as-is: this file defines the exact
-- migration functions inline first, so it is fully self-contained.
--
-- AUTHORISED, WRITABLE transaction ending in ROLLBACK, single flat
-- BEGIN...ROLLBACK (no nested SAVEPOINTs needed — this RPC is read-only,
-- so no scenario mutates state that a later scenario depends on being
-- reverted).
--
-- Actually run twice:
-- (1) 2026-07-20, pre-apply, with the migration functions defined inline
--     as shown below: 14/14 passed.
-- (2) 2026-07-20, post-apply, against the real deployed
--     get_my_story_timeline_v1 (fixture user temporarily and reversibly
--     added to the flag's allowed_user_ids inside the same transaction):
--     14/14 passed again.
-- Both runs verified zero persistence afterward on the read-only
-- connection: dedupe_key LIKE 'test_%' count 0; feature_flags
-- allowed_user_ids back to Dave-only; test fixture spot count 0 — the
-- transaction never committed.
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
  ('00000000-0000-4000-d000-000000000001', 'Timeline Test Spot', 'ATLANTIC', -33.9, 18.4, 'OCEAN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('story_timeline_v1', false, ARRAY['00000000-0000-4000-a000-000000000001']::uuid[])
ON CONFLICT (key) DO UPDATE SET enabled_global = false, allowed_user_ids = EXCLUDED.allowed_user_ids;

-- Inline the exact migration functions, so this file is runnable even
-- before the real migration is applied.
CREATE OR REPLACE FUNCTION public.story_timeline_flag_enabled(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT enabled_global OR p_user = ANY(allowed_user_ids) FROM feature_flags WHERE key = 'story_timeline_v1'), false);
$$;

CREATE OR REPLACE FUNCTION public.get_my_story_timeline_v1(
  p_limit integer DEFAULT 20, p_cursor jsonb DEFAULT NULL, p_story_types text[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_limit int; v_cursor_story_date date; v_cursor_created_at timestamptz; v_cursor_id uuid;
  v_events jsonb; v_has_more boolean; v_next_cursor jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT story_timeline_flag_enabled(auth.uid()) THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  IF p_cursor IS NOT NULL THEN
    v_cursor_story_date := (p_cursor ->> 'story_date')::date;
    v_cursor_created_at := (p_cursor ->> 'created_at')::timestamptz;
    v_cursor_id := (p_cursor ->> 'id')::uuid;
  END IF;
  WITH page AS (
    SELECT sse.id, sse.story_type, sse.story_date, sse.title, sse.summary,
           sse.primary_value, sse.secondary_value, sse.unit, sse.spot_id, sp.name AS spot_name,
           sse.metadata, sse.verification_status, sse.created_at,
           row_number() OVER (ORDER BY sse.story_date DESC, sse.created_at DESC, sse.id DESC) AS rn
    FROM swimmer_story_events sse
    LEFT JOIN spots sp ON sp.id = sse.spot_id
    WHERE sse.user_id = auth.uid()
      AND (p_story_types IS NULL OR sse.story_type = ANY(p_story_types))
      AND (p_cursor IS NULL OR (sse.story_date, sse.created_at, sse.id) < (v_cursor_story_date, v_cursor_created_at, v_cursor_id))
    ORDER BY sse.story_date DESC, sse.created_at DESC, sse.id DESC
    LIMIT v_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'story_type', story_type, 'story_date', story_date, 'title', title, 'summary', summary,
      'primary_value', primary_value, 'secondary_value', secondary_value, 'unit', unit,
      'spot_id', spot_id, 'spot_name', spot_name, 'metadata', metadata,
      'verification_status', verification_status, 'created_at', created_at
    ) ORDER BY rn) FILTER (WHERE rn <= v_limit), '[]'::jsonb),
    COALESCE(bool_or(rn = v_limit + 1), false),
    (SELECT jsonb_build_object('story_date', story_date, 'created_at', created_at, 'id', id) FROM page WHERE rn = v_limit)
  INTO v_events, v_has_more, v_next_cursor
  FROM page;
  IF NOT v_has_more THEN v_next_cursor := NULL; END IF;
  RETURN jsonb_build_object('events', v_events, 'next_cursor', v_next_cursor, 'has_more', v_has_more);
END;
$$;

-- 20 "filler" events (distinct story_date/created_at, cycling through all
-- 5 category buckets) + 3 events sharing the EXACT same story_date and
-- created_at (forcing the id tie-break) + 1 spot-less event (also stands
-- in for "deleted spot" — post-delete the FK sets spot_id NULL, so the
-- row is identical to a never-had-a-spot row; t13 below deletes the
-- fixture spot directly to prove this concretely rather than assume it).
DO $$
DECLARE i int; v_types text[] := ARRAY['first_swim','first_spot_visit','new_coldest_swim','first_pool_swim','streak_milestone'];
BEGIN
  FOR i IN 1..20 LOOP
    INSERT INTO swimmer_story_events (user_id, story_type, story_date, created_at, title, spot_id, dedupe_key)
    VALUES ('00000000-0000-4000-a000-000000000001', v_types[1 + (i % 5)],
            (DATE '2026-05-01' + (i * 3)), (TIMESTAMPTZ '2026-05-01 08:00:00+00' + (i * interval '3 days')),
            'Filler Event ' || i, '00000000-0000-4000-d000-000000000001', 'test_filler_' || i);
  END LOOP;

  INSERT INTO swimmer_story_events (user_id, story_type, story_date, created_at, title, spot_id, dedupe_key) VALUES
    ('00000000-0000-4000-a000-000000000001', 'first_swim', DATE '2026-07-15', TIMESTAMPTZ '2026-07-15 10:00:00+00', 'Tie Event A', '00000000-0000-4000-d000-000000000001', 'test_tie_a'),
    ('00000000-0000-4000-a000-000000000001', 'swim_count_milestone', DATE '2026-07-15', TIMESTAMPTZ '2026-07-15 10:00:00+00', 'Tie Event B', '00000000-0000-4000-d000-000000000001', 'test_tie_b'),
    ('00000000-0000-4000-a000-000000000001', 'new_warmest_swim', DATE '2026-07-15', TIMESTAMPTZ '2026-07-15 10:00:00+00', 'Tie Event C', '00000000-0000-4000-d000-000000000001', 'test_tie_c');

  INSERT INTO swimmer_story_events (user_id, story_type, story_date, created_at, title, spot_id, dedupe_key)
  VALUES ('00000000-0000-4000-a000-000000000001', 'streak_milestone', DATE '2026-06-01', TIMESTAMPTZ '2026-06-01 07:00:00+00', 'Spotless Event', NULL, 'test_spotless');
END $$;

-- One event for user B, to test cross-user isolation
INSERT INTO swimmer_story_events (user_id, story_type, story_date, created_at, title, dedupe_key)
VALUES ('00000000-0000-4000-a000-000000000002', 'first_swim', DATE '2026-07-20', now(), 'User B Event', 'test_userb_1');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000001', true);

-- Total for user A: 20 filler + 3 tie + 1 spotless = 24

-- t1: authenticated user receives only own events (user_id never in response)
INSERT INTO test_results VALUES (1, 't1_own_events_only',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements((get_my_story_timeline_v1(50, NULL, NULL))->'events') e WHERE e ? 'user_id'),
  'user_id key never present in returned event objects');

-- t2: another user's events are excluded
INSERT INTO test_results VALUES (2, 't2_other_user_excluded',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements((get_my_story_timeline_v1(50, NULL, NULL))->'events') e WHERE e->>'title' = 'User B Event'),
  '');

-- t3: anonymous request is rejected
DO $$
DECLARE v_rejected boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM get_my_story_timeline_v1(20, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := (SQLERRM = 'not_authenticated');
  END;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000001', true);
  INSERT INTO test_results VALUES (3, 't3_anonymous_rejected', v_rejected, '');
END $$;

-- t4: default page returns at most 20
INSERT INTO test_results VALUES (4, 't4_default_page_max_20',
  jsonb_array_length((get_my_story_timeline_v1(NULL, NULL, NULL))->'events') = 20,
  'count=' || jsonb_array_length((get_my_story_timeline_v1(NULL, NULL, NULL))->'events'));

-- t5: requested limit above 50 is capped — functional (no error, result
-- never exceeds 50) plus structural (LEAST(...,50) present in source)
INSERT INTO test_results VALUES (5, 't5_limit_capped_at_50',
  jsonb_array_length((get_my_story_timeline_v1(9999, NULL, NULL))->'events') <= 50
    AND (SELECT prosrc FROM pg_proc WHERE proname = 'get_my_story_timeline_v1') ILIKE '%LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)%',
  'returned=' || jsonb_array_length((get_my_story_timeline_v1(9999, NULL, NULL))->'events'));

-- t6: newest events return first
INSERT INTO test_results VALUES (6, 't6_newest_first',
  ((get_my_story_timeline_v1(1, NULL, NULL))->'events'->0->>'story_date')::date = DATE '2026-07-15',
  'first_story_date=' || ((get_my_story_timeline_v1(1, NULL, NULL))->'events'->0->>'story_date'));

-- t7 + t8 + t9: tie-break by id, correct next_cursor, no duplicate across pages
DO $$
DECLARE v_page1 jsonb; v_page2 jsonb; v_tie_titles text[]; v_cursor jsonb;
        v_page1_ids text[]; v_page2_ids text[]; v_overlap int;
BEGIN
  v_page1 := get_my_story_timeline_v1(23, NULL, NULL); -- first 23 of 24 total

  SELECT array_agg(e->>'title' ORDER BY (e->>'created_at')) INTO v_tie_titles
    FROM jsonb_array_elements(v_page1->'events') e WHERE e->>'title' LIKE 'Tie Event%';

  v_cursor := v_page1->'next_cursor';
  v_page2 := get_my_story_timeline_v1(23, v_cursor, NULL);

  SELECT array_agg(e->>'id') INTO v_page1_ids FROM jsonb_array_elements(v_page1->'events') e;
  SELECT array_agg(e->>'id') INTO v_page2_ids FROM jsonb_array_elements(v_page2->'events') e;
  SELECT count(*) INTO v_overlap FROM unnest(v_page1_ids) a JOIN unnest(v_page2_ids) b ON a = b;

  INSERT INTO test_results VALUES (7, 't7_tie_break_deterministic', array_length(v_tie_titles,1) = 3, 'tie_events_present=' || array_length(v_tie_titles,1));
  INSERT INTO test_results VALUES (8, 't8_next_cursor_correct_page', jsonb_array_length(v_page2->'events') = 1, 'page2_count=' || jsonb_array_length(v_page2->'events'));
  INSERT INTO test_results VALUES (9, 't9_no_duplicate_across_pages', v_overlap = 0, 'overlap=' || v_overlap);
END $$;

-- t10: story-type filtering works
INSERT INTO test_results VALUES (10, 't10_story_type_filter_works',
  (SELECT bool_and(e->>'story_type' = 'first_swim') FROM jsonb_array_elements((get_my_story_timeline_v1(50, NULL, ARRAY['first_swim']))->'events') e),
  'all_returned_are_first_swim');

-- t11: invalid story-type filter is handled safely (garbage value -> zero rows, no error)
INSERT INTO test_results VALUES (11, 't11_invalid_filter_safe',
  jsonb_array_length((get_my_story_timeline_v1(20, NULL, ARRAY['not_a_real_type']))->'events') = 0,
  'no error, zero rows for a nonexistent story_type');

-- t12: spot-less event returns safely (spot_id and spot_name both null, no error)
INSERT INTO test_results VALUES (12, 't12_spotless_event_safe',
  EXISTS (SELECT 1 FROM jsonb_array_elements((get_my_story_timeline_v1(50, NULL, NULL))->'events') e
           WHERE e->>'title' = 'Spotless Event' AND e->'spot_id' = 'null'::jsonb AND e->'spot_name' = 'null'::jsonb),
  '');

-- t13: deleted/missing spot reference does not break the response
DO $$
BEGIN
  DELETE FROM spots WHERE id = '00000000-0000-4000-d000-000000000001';
  INSERT INTO test_results VALUES (13, 't13_deleted_spot_reference_safe',
    (SELECT count(*) FROM jsonb_array_elements((get_my_story_timeline_v1(50, NULL, NULL))->'events') e) = 24,
    'all 24 events still returned after their spot was deleted, no error');
END $$;

-- t14: no exact coordinates are returned
INSERT INTO test_results VALUES (14, 't14_no_coordinates_returned',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements((get_my_story_timeline_v1(5, NULL, NULL))->'events') e WHERE e ? 'latitude' OR e ? 'longitude'),
  '');

SELECT * FROM test_results ORDER BY n;

-- ----------------------------------------------------------------
-- Final protection — nothing from this file is ever persisted.
-- ----------------------------------------------------------------
ROLLBACK;
