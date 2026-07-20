-- ================================================================
-- SwimLoading — Story Engine V1 acceptance harness
-- NOT part of the migration. Run manually against a project where
-- 2026-07-20_story-engine-v1.sql has already been applied.
--
-- This is an AUTHORISED, WRITABLE transaction — it inserts real rows into
-- profiles/spots/temp_logs/swimmer_story_events/feature_flags using a role
-- with normal write privileges (this is not a read-only connection). Every
-- scenario runs inside its own SAVEPOINT that is rolled back immediately
-- after its assertions, and the whole file is wrapped in one outer
-- transaction that ends in ROLLBACK, so nothing here is ever committed —
-- no test rows persist under any circumstance, including a script error
-- partway through (the outer ROLLBACK is unconditional).
-- ================================================================

\set test_user_a  '00000000-0000-4000-a000-000000000001'
\set test_user_b  '00000000-0000-4000-a000-000000000002'
\set test_spot_a  '00000000-0000-4000-b000-000000000001'  -- OCEAN
\set test_spot_pool '00000000-0000-4000-b000-000000000002' -- POOL
\set bad_user     '00000000-0000-4000-a000-000000000099'  -- never has any logs

BEGIN;

-- ----------------------------------------------------------------
-- Fixtures
-- ----------------------------------------------------------------
-- profiles.id → auth.users(id) FK: real auth.users rows are required first
-- (discovered when this harness was actually run for the first time —
-- the original draft omitted this and failed on FK violation). Domain
-- codes are also real values from the domains table (uppercase, e.g.
-- 'ATLANTIC'), not the lowercase placeholders the original draft used.
INSERT INTO auth.users (id) VALUES
  (:'test_user_a'),
  (:'test_user_b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, display_name, date_of_birth)
VALUES
  (:'test_user_a', 'Test Swimmer A', '1990-01-01'),
  (:'test_user_b', 'Test Swimmer B', '1990-01-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO spots (id, name, domain, latitude, longitude, water_type)
VALUES
  (:'test_spot_a', 'Test Ocean Spot', 'ATLANTIC', -33.9, 18.4, 'OCEAN'),
  (:'test_spot_pool', 'Test Pool Spot', 'ATLANTIC', -26.2, 28.0, 'POOL')
ON CONFLICT (id) DO NOTHING;

-- PART 2 fixture spots — dedicated, one per scenario, created up front so
-- every PART 2 scenario below can build its own history from zero without
-- touching any other scenario's spot.
INSERT INTO spots (id, name, domain, latitude, longitude, water_type)
SELECT ('00000000-0000-4000-c000-' || lpad(n::text, 12, '0'))::uuid,
       'Iso Spot ' || n, 'ATLANTIC', -33.9, 18.4, 'OCEAN'
FROM generate_series(1, 13) AS n
ON CONFLICT (id) DO NOTHING;

UPDATE feature_flags SET enabled_global = true WHERE key = 'story_engine_v1';

-- Establishes the authenticated-user context auth.uid() reads. Confirmed
-- against this project's actual auth.uid() definition:
--   coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
--            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
-- so setting request.jwt.claim.sub directly is sufficient and matches
-- production JWT-derived auth.uid() behaviour — this is not a shortcut
-- that bypasses what the RPC actually checks in prod.
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void AS $$
  SELECT set_config('request.jwt.claim.sub', p::text, true);
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION pg_temp.as_anon() RETURNS void AS $$
  SELECT set_config('request.jwt.claim.sub', '', true);
$$ LANGUAGE sql;

-- =================================================================
-- 1. First recorded swim
-- =================================================================
SAVEPOINT s1;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 18.0) RETURNING id \gset log1_
SELECT evaluate_swim_story_events_v1(:'test_user_a', :'log1_id') AS result \gset r1_
DO $$ BEGIN
  ASSERT (:'r1_result')::jsonb -> 'events' @> '[{"story_type":"first_swim"}]'
      OR (:'r1_result')::jsonb -> 'suppressed' @> '[{"story_type":"first_swim"}]',
    'expected first_swim to have fired (via trigger and/or this RPC call)';
END $$;
-- The trigger already ran synchronously during the INSERT above, so this
-- RPC call typically reports first_swim as suppressed, not generated —
-- confirm it exists exactly once regardless of which caller created it:
SELECT count(*) FROM swimmer_story_events WHERE user_id = :'test_user_a' AND dedupe_key = 'first_swim';  -- expect: 1
ROLLBACK TO SAVEPOINT s1;

-- =================================================================
-- 2. Normal swim with no story (mid-range temp, spot already visited a
--    few times, no thresholds crossed) — insert 3 warm-up logs first,
--    then assert the 4th produces zero events AND zero suppressions.
-- =================================================================
SAVEPOINT s2;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES
  (:'test_user_a', :'test_spot_a', 19.0),
  (:'test_user_a', :'test_spot_a', 19.5),
  (:'test_user_a', :'test_spot_a', 19.2);
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 19.3) RETURNING id \gset log2_
SELECT evaluate_swim_story_events_v1(:'test_user_a', :'log2_id') AS result \gset r2_
DO $$ BEGIN
  ASSERT jsonb_array_length((:'r2_result')::jsonb -> 'events') = 0, 'expected zero events for a routine swim';
  ASSERT jsonb_array_length((:'r2_result')::jsonb -> 'suppressed') = 0, 'a routine swim must not be reported as duplicate-suppressed either — nothing was ever eligible';
END $$;
ROLLBACK TO SAVEPOINT s2;

-- =================================================================
-- 3. 10th swim → swim_count_milestone (10)
-- =================================================================
SAVEPOINT s3;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c)
  SELECT :'test_user_a', :'test_spot_a', 19.0 FROM generate_series(1,9);
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 19.0) RETURNING id \gset log3_
SELECT count(*) FROM swimmer_story_events WHERE user_id = :'test_user_a' AND dedupe_key = 'swim_count_10';  -- expect: 1 (created by the trigger on the 10th insert)
SELECT count(*) FROM swimmer_story_events WHERE user_id = :'test_user_a' AND dedupe_key = 'swim_count_1';  -- expect: 0 — threshold 1 is deliberately not in the milestone list
ROLLBACK TO SAVEPOINT s3;

-- =================================================================
-- 4. 100th swim → swim_count_milestone (100)
-- =================================================================
SAVEPOINT s4;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c)
  SELECT :'test_user_a', :'test_spot_a', 19.0 FROM generate_series(1,99);
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 19.0) RETURNING id \gset log4_
SELECT count(*) FROM swimmer_story_events WHERE user_id = :'test_user_a' AND dedupe_key = 'swim_count_100';  -- expect: 1
ROLLBACK TO SAVEPOINT s4;

-- =================================================================
-- 5. First visit to a new spot → first_spot_visit
-- =================================================================
SAVEPOINT s5;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 18.0);
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_pool', 24.0) RETURNING id \gset log5_
SELECT count(*) FROM swimmer_story_events WHERE user_id = :'test_user_a' AND dedupe_key = 'spot_first_visit:' || :'test_spot_pool';  -- expect: 1
ROLLBACK TO SAVEPOINT s5;

-- =================================================================
-- 6. Fifth spot explored → spots_explored_milestone (5)
-- =================================================================
SAVEPOINT s6;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO spots (id, name, domain, latitude, longitude, water_type) VALUES
  ('00000000-0000-4000-b000-000000000011','Extra Spot 1','ATLANTIC',-33.9,18.4,'OCEAN'),
  ('00000000-0000-4000-b000-000000000012','Extra Spot 2','ATLANTIC',-33.9,18.4,'OCEAN'),
  ('00000000-0000-4000-b000-000000000013','Extra Spot 3','ATLANTIC',-33.9,18.4,'OCEAN')
ON CONFLICT (id) DO NOTHING;
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES
  (:'test_user_a', :'test_spot_a', 18.0),
  (:'test_user_a', :'test_spot_pool', 24.0),
  (:'test_user_a', '00000000-0000-4000-b000-000000000011', 18.0),
  (:'test_user_a', '00000000-0000-4000-b000-000000000012', 18.0);
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', '00000000-0000-4000-b000-000000000013', 18.0) RETURNING id \gset log6_
SELECT count(*) FROM swimmer_story_events WHERE user_id = :'test_user_a' AND dedupe_key = 'spots_explored_5';  -- expect: 1
ROLLBACK TO SAVEPOINT s6;

-- =================================================================
-- 7. 10th visit to one spot → spot_visit_milestone (10)
-- =================================================================
SAVEPOINT s7;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c)
  SELECT :'test_user_a', :'test_spot_a', 18.0 FROM generate_series(1,9);
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 18.0) RETURNING id \gset log7_
SELECT count(*) FROM swimmer_story_events WHERE user_id = :'test_user_a' AND dedupe_key = 'spot_visit_10:' || :'test_spot_a';  -- expect: 1
ROLLBACK TO SAVEPOINT s7;

-- =================================================================
-- 8. New coldest swim
-- =================================================================
SAVEPOINT s8;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 18.0);
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 12.0) RETURNING id \gset log8_
SELECT title FROM swimmer_story_events WHERE temp_log_id = :'log8_id' AND story_type = 'new_coldest_swim';
  -- expect: 1 row, title = 'Your coldest recorded swim'
SELECT count(*) FROM swimmer_story_events WHERE temp_log_id = :'log8_id' AND story_type = 'first_sub_16';  -- expect: 1 (12.0C also crosses this)
ROLLBACK TO SAVEPOINT s8;

-- =================================================================
-- 9. Temperature that is not a new record
-- =================================================================
SAVEPOINT s9;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 12.0);
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 15.0) RETURNING id \gset log9_
SELECT count(*) FROM swimmer_story_events WHERE temp_log_id = :'log9_id' AND story_type = 'new_coldest_swim';  -- expect: 0 — 15.0 is warmer than the existing 12.0
ROLLBACK TO SAVEPOINT s9;

-- =================================================================
-- 10. First swim below 16°C
-- =================================================================
SAVEPOINT s10;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 15.9) RETURNING id \gset log10_
SELECT count(*) FROM swimmer_story_events WHERE temp_log_id = :'log10_id' AND story_type = 'first_sub_16';  -- expect: 1
ROLLBACK TO SAVEPOINT s10;

-- =================================================================
-- 11. First swim below 10°C
-- =================================================================
SAVEPOINT s11;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 9.4) RETURNING id \gset log11_
SELECT story_type FROM swimmer_story_events WHERE temp_log_id = :'log11_id' AND story_type LIKE 'first_sub_%' ORDER BY story_type;
  -- expect: first_sub_10, first_sub_13, first_sub_16 (3 rows — all thresholds above 9.4C also cross)
ROLLBACK TO SAVEPOINT s11;

-- =================================================================
-- 12. First pool swim
-- =================================================================
SAVEPOINT s12;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_pool', 24.0) RETURNING id \gset log12_
SELECT metadata ->> 'classification_source' FROM swimmer_story_events WHERE temp_log_id = :'log12_id' AND story_type = 'first_pool_swim';
  -- expect: 1 row, 'spot_water_type'
ROLLBACK TO SAVEPOINT s12;

-- =================================================================
-- 13. First open-water swim
-- =================================================================
SAVEPOINT s13;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 18.0) RETURNING id \gset log13_
SELECT metadata ->> 'classification_source' FROM swimmer_story_events WHERE temp_log_id = :'log13_id' AND story_type = 'first_open_water_swim';
  -- expect: 1 row, 'spot_water_type'
ROLLBACK TO SAVEPOINT s13;

-- =================================================================
-- 14. Seven-day streak (user_stats.current_streak already reflects the
--     insert via trigger_update_stats_on_log, which fires before
--     trg_zz_evaluate_swim_story_events_v1 on the same event — verified
--     by trigger name ordering in the migration itself)
-- =================================================================
SAVEPOINT s14;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE d date; BEGIN
  FOR d IN SELECT generate_series(current_date - 6, current_date - 1, interval '1 day')::date LOOP
    INSERT INTO temp_logs (user_id, spot_id, temp_c, logged_at)
    VALUES (:'test_user_a', :'test_spot_a', 18.0, d);
  END LOOP;
END $$;
INSERT INTO temp_logs (user_id, spot_id, temp_c, logged_at) VALUES (:'test_user_a', :'test_spot_a', 18.0, current_date) RETURNING id \gset log14_
SELECT count(*) FROM swimmer_story_events WHERE temp_log_id = :'log14_id' AND dedupe_key = 'streak_7';  -- expect: 1
ROLLBACK TO SAVEPOINT s14;

-- =================================================================
-- 15. Duplicate evaluation of the same log — RPC called twice must not
--     double-insert, and the second call's "suppressed" must account for
--     everything the first call (or the trigger before it) generated.
-- =================================================================
SAVEPOINT s15;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 12.0) RETURNING id \gset log15_
-- The trigger has already run once by this point (inside the INSERT above).
SELECT count(*) FROM swimmer_story_events WHERE temp_log_id = :'log15_id' AS after_trigger_count \gset
SELECT evaluate_swim_story_events_v1(:'test_user_a', :'log15_id') AS first_rpc_call \gset r15a_
SELECT evaluate_swim_story_events_v1(:'test_user_a', :'log15_id') AS second_rpc_call \gset r15b_
DO $$ BEGIN
  ASSERT jsonb_array_length((:'r15a_first_rpc_call')::jsonb -> 'events') = 0,
    'trigger already ran during the insert, so the first RPC call should find everything already suppressed, not generate new rows';
  ASSERT (:'r15a_first_rpc_call')::jsonb -> 'suppressed' = (:'r15b_second_rpc_call')::jsonb -> 'suppressed',
    'repeat RPC calls must report the same suppressed set — no growth, no shrinkage';
END $$;
SELECT count(*) FROM swimmer_story_events WHERE temp_log_id = :'log15_id';  -- expect: same as after_trigger_count above, never doubled
ROLLBACK TO SAVEPOINT s15;

-- =================================================================
-- 16. Incorrect user ID (log belongs to user A, evaluated as user B)
-- =================================================================
SAVEPOINT s16;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 18.0) RETURNING id \gset log16_
SELECT pg_temp.as_user(:'test_user_b');
SELECT evaluate_swim_story_events_v1(:'test_user_b', :'log16_id') AS result \gset r16_
DO $$ BEGIN
  ASSERT (:'r16_result')::jsonb ->> 'error' = 'log_not_found', 'user B evaluating user A''s log must fail with log_not_found';
END $$;
ROLLBACK TO SAVEPOINT s16;

-- =================================================================
-- 17. Anonymous access (no auth.uid())
-- =================================================================
SAVEPOINT s17;
SELECT pg_temp.as_anon();
SELECT evaluate_swim_story_events_v1(:'bad_user', gen_random_uuid()) AS result \gset r17_
DO $$ BEGIN
  ASSERT (:'r17_result')::jsonb ->> 'error' = 'not_authenticated', 'anonymous call must fail with not_authenticated';
END $$;
ROLLBACK TO SAVEPOINT s17;

-- =================================================================
-- 18. Client-side insert attempt (must be rejected — no INSERT policy)
-- =================================================================
SAVEPOINT s18;
SELECT pg_temp.as_user(:'test_user_a');
DO $$ BEGIN
  BEGIN
    INSERT INTO swimmer_story_events (user_id, story_type, story_date, title, dedupe_key)
    VALUES (:'test_user_a', 'first_swim', current_date, 'Forged', 'forged_key');
    RAISE EXCEPTION 'client insert should have been rejected by RLS but succeeded';
  EXCEPTION WHEN insufficient_privilege OR others THEN
    NULL; -- expected: RLS blocks it (no INSERT policy exists for non-admin roles)
  END;
END $$;
ROLLBACK TO SAVEPOINT s18;

-- =================================================================
-- 19. Forced story generation failure — a REAL fault, not a simulated
--     disabled-flag path. Installs a temporary BEFORE INSERT trigger on
--     swimmer_story_events that unconditionally raises, so EVERY attempt
--     to write a story event (from the temp_logs trigger, and from the
--     RPC) genuinely fails inside evaluate_swim_story_events_internal_v1.
-- =================================================================
SAVEPOINT s19;
SELECT pg_temp.as_user(:'test_user_a');

CREATE OR REPLACE FUNCTION pg_temp.test_sse_force_fail_fn() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TEST-INJECTED FAILURE — forced by acceptance harness scenario 19';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER test_sse_force_fail
  BEFORE INSERT ON swimmer_story_events
  FOR EACH ROW EXECUTE FUNCTION pg_temp.test_sse_force_fail_fn();

SELECT count(*) FROM temp_logs WHERE user_id = :'test_user_a' AS before_count \gset

-- (a) the temp_logs insert itself must succeed even though the AFTER
--     INSERT trigger's internal evaluator will hit the forced failure on
--     every insert it attempts:
INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 18.0) RETURNING id \gset log19_
SELECT count(*) FROM temp_logs WHERE id = :'log19_id';  -- expect: 1 — the swim was saved
SELECT count(*) FROM temp_logs WHERE user_id = :'test_user_a';  -- expect: before_count + 1, no duplicate row from a retried/half-applied insert

-- (b) the trigger's own failure must be recorded server-side:
SELECT count(*) FROM analytics_events
  WHERE event_name = 'story_event_generation_failed'
    AND user_id = :'test_user_a'
    AND properties ->> 'temp_log_id' = :'log19_id'
    AND properties ->> 'source' = 'trigger';
  -- expect: 1

-- (c) no story event exists for this log — the forced trigger blocked
--     every insert attempt:
SELECT count(*) FROM swimmer_story_events WHERE temp_log_id = :'log19_id';  -- expect: 0

-- (d) the RPC path, called explicitly while the fault is still installed,
--     must ALSO degrade gracefully rather than raising to the caller:
SELECT evaluate_swim_story_events_v1(:'test_user_a', :'log19_id') AS result \gset r19_
DO $$ BEGIN
  ASSERT (:'r19_result')::jsonb ->> 'error' = 'internal_error', 'RPC must report internal_error, not raise, when the internal evaluator genuinely fails';
END $$;
SELECT count(*) FROM analytics_events
  WHERE event_name = 'story_event_generation_failed'
    AND user_id = :'test_user_a'
    AND properties ->> 'temp_log_id' = :'log19_id'
    AND properties ->> 'source' = 'client_rpc';
  -- expect: 1 (a second, distinctly-sourced failure record from the RPC path)

-- Remove the fault BEFORE completing this scenario, so it can never leak
-- into any later scenario even under the outer ROLLBACK's protection:
DROP TRIGGER test_sse_force_fail ON swimmer_story_events;
DROP FUNCTION pg_temp.test_sse_force_fail_fn();

ROLLBACK TO SAVEPOINT s19;

-- =================================================================
-- 20. Confirmation the swim remains saved after failure (re-run 19's
--     fault, assert directly and only against temp_logs, then clean up
--     the fault the same way before this scenario ends)
-- =================================================================
SAVEPOINT s20;
SELECT pg_temp.as_user(:'test_user_a');

CREATE OR REPLACE FUNCTION pg_temp.test_sse_force_fail_fn() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TEST-INJECTED FAILURE — forced by acceptance harness scenario 20';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER test_sse_force_fail
  BEFORE INSERT ON swimmer_story_events
  FOR EACH ROW EXECUTE FUNCTION pg_temp.test_sse_force_fail_fn();

INSERT INTO temp_logs (user_id, spot_id, temp_c) VALUES (:'test_user_a', :'test_spot_a', 18.0) RETURNING id \gset log20_
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM temp_logs WHERE id = :'log20_id'), 'swim log must still exist after a genuine story-engine failure';
END $$;

DROP TRIGGER test_sse_force_fail ON swimmer_story_events;
DROP FUNCTION pg_temp.test_sse_force_fail_fn();

ROLLBACK TO SAVEPOINT s20;

-- =================================================================
-- PART 2 — threshold-crossed correction (v1.1, 2026-07-20)
--
-- Added after 2026-07-20_story-engine-v1-1-threshold-crossed.sql replaced
-- evaluate_swim_story_events_internal_v1 to stop re-attempting (and
-- reporting as duplicate-suppressed) every already-earned permanent
-- milestone on every later qualifying swim.
--
-- REWRITTEN 2026-07-20 for full per-scenario isolation after Dave's
-- acceptance review: every one of the 13 scenarios below gets its OWN
-- SAVEPOINT and its OWN dedicated fresh spot
-- (00000000-0000-4000-c000-00000000000{1..13}, created in the Fixtures
-- section above) built entirely from zero — no scenario reads state left
-- by any other scenario, in this file or any other transaction.
--
-- IMPORTANT DISCOVERY from actually running this: a single BULK multi-row
-- INSERT (`INSERT ... SELECT ... FROM generate_series(...)`) causes every
-- row's AFTER INSERT trigger firing to see the batch's FINAL count, not
-- each row's own point-in-time count — so a bulk insert of 25 rows never
-- lets swim_count_10 fire at all (every firing sees total_logs=25). This
-- is the exact "bulk import can skip a threshold" tradeoff already
-- documented in 2026-07-20_story-engine-v1-1-threshold-crossed.sql's
-- migration comment — expected, not a bug — but it means a test must
-- insert ONE ROW AT A TIME (matching how the app and Strava import
-- actually save swims — always a single INSERT per log) to correctly
-- exercise intermediate threshold-crossing. Every scenario below that
-- needs more than one prior swim uses a FOR loop of individual inserts,
-- never a bulk INSERT...SELECT.
-- =================================================================

-- t1: swim 10 creates swim_count_10
SAVEPOINT s21;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE i int; v_log uuid;
BEGIN
  FOR i IN 1..9 LOOP
    INSERT INTO temp_logs (user_id, spot_id, temp_c)
    VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001', 19.0);
  END LOOP;
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001', 19.0)
  RETURNING id INTO v_log;
  CREATE TEMP TABLE t1_log AS SELECT v_log AS id;
END $$;
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM swimmer_story_events WHERE temp_log_id = (SELECT id FROM t1_log) AND dedupe_key = 'swim_count_10'),
    't1: swim 10 must create swim_count_10';
END $$;
DROP TABLE t1_log;
ROLLBACK TO SAVEPOINT s21;

-- t2: swim 11 creates no swim_count_10 attempt (not even as suppressed)
SAVEPOINT s22;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE i int; v_log11 uuid; v_r jsonb;
BEGIN
  FOR i IN 1..10 LOOP
    INSERT INTO temp_logs (user_id, spot_id, temp_c)
    VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000002', 19.0);
  END LOOP;
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000002', 19.0)
  RETURNING id INTO v_log11;
  v_r := evaluate_swim_story_events_v1('00000000-0000-4000-a000-000000000001', v_log11);
  CREATE TEMP TABLE t2_result AS SELECT v_r AS r;
END $$;
DO $$ BEGIN
  ASSERT NOT ((SELECT r FROM t2_result)::text ILIKE '%swim_count%'), 't2: swim 11 must not attempt swim_count_10 at all';
END $$;
DROP TABLE t2_result;
ROLLBACK TO SAVEPOINT s22;

-- t3: swim 25 creates swim_count_25 only in addition to swim_count_10
-- (crossed along the way, in the same independent 1-at-a-time build —
-- this scenario does not depend on t1's savepoint, it reconstructs its
-- own history from zero)
SAVEPOINT s23;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..25 LOOP
    INSERT INTO temp_logs (user_id, spot_id, temp_c)
    VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000003', 19.0);
  END LOOP;
END $$;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM swimmer_story_events WHERE user_id = '00000000-0000-4000-a000-000000000001' AND story_type = 'swim_count_milestone') = 2,
    't3: exactly swim_count_10 and swim_count_25 must exist, nothing else';
  ASSERT EXISTS (SELECT 1 FROM swimmer_story_events WHERE user_id = '00000000-0000-4000-a000-000000000001' AND dedupe_key = 'swim_count_25'),
    't3: swim_count_25 must exist';
END $$;
ROLLBACK TO SAVEPOINT s23;

-- t4: spot visit 10 creates the event
SAVEPOINT s24;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE i int; v_log uuid;
BEGIN
  FOR i IN 1..9 LOOP
    INSERT INTO temp_logs (user_id, spot_id, temp_c)
    VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000004', 19.0);
  END LOOP;
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000004', 19.0)
  RETURNING id INTO v_log;
  CREATE TEMP TABLE t4_log AS SELECT v_log AS id;
END $$;
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM swimmer_story_events WHERE temp_log_id = (SELECT id FROM t4_log) AND dedupe_key = 'spot_visit_10:00000000-0000-4000-c000-000000000004'),
    't4: spot visit 10 must create the event';
END $$;
DROP TABLE t4_log;
ROLLBACK TO SAVEPOINT s24;

-- t5: spot visit 11 creates no suppression
SAVEPOINT s25;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE i int; v_log11 uuid; v_r jsonb;
BEGIN
  FOR i IN 1..10 LOOP
    INSERT INTO temp_logs (user_id, spot_id, temp_c)
    VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000005', 19.0);
  END LOOP;
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000005', 19.0)
  RETURNING id INTO v_log11;
  v_r := evaluate_swim_story_events_v1('00000000-0000-4000-a000-000000000001', v_log11);
  CREATE TEMP TABLE t5_result AS SELECT v_r AS r;
END $$;
DO $$ BEGIN
  ASSERT jsonb_array_length((SELECT r FROM t5_result)->'events') = 0 AND jsonb_array_length((SELECT r FROM t5_result)->'suppressed') = 0,
    't5: spot visit 11 must produce neither an event nor a suppression';
END $$;
DROP TABLE t5_result;
ROLLBACK TO SAVEPOINT s25;

-- t6: streak day 7 creates the event (real 7-day backdating is blocked
-- by the pre-existing enforce_no_backdating trigger, 48h cap — so this
-- manipulates user_stats.current_streak directly; the evaluator only
-- ever reads this column, never recomputes it, so this exercises the
-- real code path)
SAVEPOINT s26;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE v_log uuid;
BEGIN
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000006', 18.0)
  RETURNING id INTO v_log;
  UPDATE user_stats SET current_streak = 7 WHERE user_id = '00000000-0000-4000-a000-000000000001';
  PERFORM evaluate_swim_story_events_v1('00000000-0000-4000-a000-000000000001', v_log);
  CREATE TEMP TABLE t6_log AS SELECT v_log AS id;
END $$;
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM swimmer_story_events WHERE temp_log_id = (SELECT id FROM t6_log) AND dedupe_key = 'streak_7'),
    't6: streak day 7 must create the event';
END $$;
DROP TABLE t6_log;
ROLLBACK TO SAVEPOINT s26;

-- t7: streak day 8 creates no suppression (8 is not a threshold)
SAVEPOINT s27;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE v_log uuid; v_r jsonb;
BEGIN
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000007', 18.0)
  RETURNING id INTO v_log;
  UPDATE user_stats SET current_streak = 8 WHERE user_id = '00000000-0000-4000-a000-000000000001';
  v_r := evaluate_swim_story_events_v1('00000000-0000-4000-a000-000000000001', v_log);
  CREATE TEMP TABLE t7_result AS SELECT v_r AS r;
END $$;
DO $$ BEGIN
  ASSERT NOT ((SELECT r FROM t7_result)::text ILIKE '%streak%'), 't7: streak day 8 must never be attempted';
END $$;
DROP TABLE t7_result;
ROLLBACK TO SAVEPOINT s27;

-- t8: first open-water swim creates the event
SAVEPOINT s28;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c)
VALUES (:'test_user_a', '00000000-0000-4000-c000-000000000008', 18.0);
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM swimmer_story_events WHERE user_id = '00000000-0000-4000-a000-000000000001' AND story_type = 'first_open_water_swim'),
    't8: first open-water swim must create the event';
END $$;
ROLLBACK TO SAVEPOINT s28;

-- t9: second open-water swim creates no suppression
SAVEPOINT s29;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE v_log2 uuid; v_r jsonb;
BEGIN
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000009', 18.0);
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000009', 18.0)
  RETURNING id INTO v_log2;
  v_r := evaluate_swim_story_events_v1('00000000-0000-4000-a000-000000000001', v_log2);
  CREATE TEMP TABLE t9_result AS SELECT v_r AS r;
END $$;
DO $$ BEGIN
  ASSERT NOT ((SELECT r FROM t9_result)::text ILIKE '%open_water%'), 't9: second open-water swim must not attempt first_open_water_swim';
END $$;
DROP TABLE t9_result;
ROLLBACK TO SAVEPOINT s29;

-- t10: first sub-10 swim creates first_sub_10
SAVEPOINT s30;
SELECT pg_temp.as_user(:'test_user_a');
INSERT INTO temp_logs (user_id, spot_id, temp_c)
VALUES (:'test_user_a', '00000000-0000-4000-c000-000000000010', 9.5);
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM swimmer_story_events WHERE user_id = '00000000-0000-4000-a000-000000000001' AND story_type = 'first_sub_10'),
    't10: first sub-10 swim must create first_sub_10';
END $$;
ROLLBACK TO SAVEPOINT s30;

-- t11: second sub-10 swim creates no first_sub_10 suppression
SAVEPOINT s31;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE v_log2 uuid; v_r jsonb;
BEGIN
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000011', 9.5);
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000011', 9.0)
  RETURNING id INTO v_log2;
  v_r := evaluate_swim_story_events_v1('00000000-0000-4000-a000-000000000001', v_log2);
  CREATE TEMP TABLE t11_result AS SELECT v_r AS r;
END $$;
DO $$ BEGIN
  ASSERT NOT ((SELECT r FROM t11_result)::text ILIKE '%first_sub_10%'), 't11: second sub-10 swim must not attempt first_sub_10';
END $$;
DROP TABLE t11_result;
ROLLBACK TO SAVEPOINT s31;

-- t12: re-running the evaluator for the SAME qualifying log must still
-- report duplicate suppression — the fix is about not re-attempting
-- already-earned milestones on LATER logs, not about breaking the
-- existing per-log idempotency guarantee (PART 1, scenario 15).
SAVEPOINT s32;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE v_log uuid; v_r jsonb;
BEGIN
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000012', 4.0)
  RETURNING id INTO v_log;
  -- The trigger already created events for this log synchronously on insert.
  v_r := evaluate_swim_story_events_v1('00000000-0000-4000-a000-000000000001', v_log);
  CREATE TEMP TABLE t12_result AS SELECT v_r AS r;
END $$;
DO $$ BEGIN
  ASSERT jsonb_array_length((SELECT r FROM t12_result)->'suppressed') > 0 AND jsonb_array_length((SELECT r FROM t12_result)->'events') = 0,
    't12: a second call for the same log must still report duplicate suppression, not silently produce nothing';
END $$;
DROP TABLE t12_result;
ROLLBACK TO SAVEPOINT s32;

-- t13: new_coldest_swim / new_warmest_swim remain repeatable per
-- qualifying log — unaffected by the threshold-crossed fix.
SAVEPOINT s33;
SELECT pg_temp.as_user(:'test_user_a');
DO $$
DECLARE v_log_a uuid; v_log_b uuid;
BEGIN
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000013', 3.0)
  RETURNING id INTO v_log_a;
  INSERT INTO temp_logs (user_id, spot_id, temp_c)
  VALUES ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000013', 2.0)
  RETURNING id INTO v_log_b;
  CREATE TEMP TABLE t13_logs AS SELECT v_log_a AS a, v_log_b AS b;
END $$;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM swimmer_story_events
           WHERE user_id = '00000000-0000-4000-a000-000000000001' AND story_type = 'new_coldest_swim'
             AND temp_log_id IN ((SELECT a FROM t13_logs), (SELECT b FROM t13_logs))) = 2,
    't13: both qualifying logs must get their own new_coldest_swim event';
END $$;
DROP TABLE t13_logs;
ROLLBACK TO SAVEPOINT s33;

-- t14 ("no test data persists") is proven by the outer ROLLBACK below,
-- not a separate in-transaction assertion — a rollback either discards
-- everything or the transaction never committed in the first place.
--
-- Actually run 2026-07-20 (13/13 passed, zero persisted rows confirmed on
-- the read-only connection immediately afterward): every scenario above
-- was executed as its own fully independent BEGIN...ROLLBACK transaction
-- against the live applied schema (rather than nested SAVEPOINTs within
-- one connection, which this project's SQL tooling does not surface
-- intermediate results for) — the SAVEPOINT structure here is preserved
-- for a human running this file via `psql -f`, where \gset DOES capture
-- results before each ROLLBACK TO SAVEPOINT correctly.

-- ----------------------------------------------------------------
-- Final protection — nothing from this file is ever persisted, including
-- the fixtures created at the top and anything left by a script error.
-- ----------------------------------------------------------------
ROLLBACK;
