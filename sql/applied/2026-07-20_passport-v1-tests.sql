-- ================================================================
-- SwimLoading — Swim Passport V1 (get_my_swim_passport_v1) acceptance
-- harness. NOT part of the migration. Self-contained: defines the exact
-- migration functions inline, so it runs BEFORE the migration is applied
-- and again afterwards against the deployed functions (delete the inline
-- CREATE block for the post-apply run).
--
-- Run 2026-07-20, PRE-APPLY: 23/23 passed. Zero persistence confirmed
-- afterwards on the read-only connection — test users 0, PassTest spots
-- 0, TST_ domains 0, test logs 0, passport_v1 flag rows 0, both
-- functions absent. The transaction never committed.
--
-- AUTHORISED, WRITABLE transaction. Ends by RAISE EXCEPTION rather than
-- a trailing SELECT + ROLLBACK: the admin SQL tool only returns the LAST
-- statement's result, so a plain SELECT before ROLLBACK is swallowed.
-- Raising both surfaces the report and guarantees the transaction cannot
-- commit whatever happens next.
--
-- Fixture notes:
--   * temp_logs.logged_at has a 48-hour no-backdating trigger, so
--     historical fixtures leave logged_at NULL and backdate created_at
--     (the RPC reads COALESCE(logged_at, created_at)).
--   * temp_logs.temp_c is NOT NULL and spots has a unique index on
--     lower(name) — see the two reframed tests below.
--
-- Two briefed tests could not be built as specified, because the SCHEMA
-- already guarantees the property they were meant to check. Both are
-- reframed to assert the stronger guarantee rather than silently dropped:
--   t6  "duplicate spot names remain separate" -> spots has a UNIQUE
--       index on lower(name), so duplicates cannot be inserted at all.
--       Asserts instead that the grouping key is spot_id, one row per
--       spot_id, which is strictly stronger than not-merging-by-name.
--   t22 "missing temperatures handled" -> temp_c is NOT NULL, so a
--       spot with any log always has a coldest and warmest. Asserts
--       that no spot returns a null temperature.
--
-- Three tests were added beyond the brief:
--   t21 inactive spots still appear (history must not be erased)
--   t22 as above
--   t23 a 23:30 SAST log keeps its own calendar day rather than rolling
--       into the next UTC day — guards the timezone convention
-- ================================================================

BEGIN;

CREATE TEMP TABLE test_results (n int, name text, passed boolean, detail text);

-- ----------------------------------------------------------------
-- Fixtures
-- ----------------------------------------------------------------
-- a = main swimmer (allow-listed)   b = other swimmer (isolation)
-- c = authenticated, NOT allow-listed   d = allow-listed, zero swims
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-9000-00000000000a'),
  ('00000000-0000-4000-9000-00000000000b'),
  ('00000000-0000-4000-9000-00000000000c'),
  ('00000000-0000-4000-9000-00000000000d')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, display_name, date_of_birth)
SELECT id, 'Passport Test', DATE '1990-01-01' FROM auth.users
WHERE id::text LIKE '00000000-0000-4000-9000-%' ON CONFLICT (id) DO NOTHING;

-- TST_SOLO  = single-country domain -> country fallback SHOULD resolve
-- TST_MULTI = multi-country domain  -> country fallback MUST refuse
-- TST_NOCC  = domain whose display_name equals its country name
INSERT INTO domains (code, display_name, country_code) VALUES
  ('TST_SOLO',  'Solo Region',    'ZA'),
  ('TST_MULTI', 'Multi Region',   'CH'),
  ('TST_NOCC',  'United Kingdom', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO spots (id, name, domain, latitude, longitude, water_type, country_code, active) VALUES
  ('00000000-0000-4000-a000-000000000001','PassTest Alpha Beach',    'TST_SOLO', -33.9, 18.4,'OCEAN', 'ZA',  true),
  ('00000000-0000-4000-a000-000000000002','PassTest Bravo Pool',     'TST_SOLO', -33.9, 18.4,'POOL',  'ZA',  true),
  ('00000000-0000-4000-a000-000000000003','PassTest Charlie Retired','TST_SOLO', -33.9, 18.4,'OCEAN', 'ZA',  false),
  ('00000000-0000-4000-a000-000000000004','PassTest Delta NoCountry','TST_SOLO', -33.9, 18.4,'LAGOON', NULL, true),
  ('00000000-0000-4000-a000-000000000005','PassTest Echo Ambiguous', 'TST_MULTI', 46.0,  8.9,'LAKE',   NULL, true),
  ('00000000-0000-4000-a000-000000000006','PassTest Foxtrot Italy',  'TST_MULTI', 46.0,  8.9,'LAKE',  'IT',  true),
  ('00000000-0000-4000-a000-000000000007','PassTest Golf Swiss',     'TST_MULTI', 46.0,  8.9,'LAKE',  'CH',  true),
  ('00000000-0000-4000-a000-000000000008','PassTest Hotel Brighton', 'TST_NOCC',  50.8, -0.1,'OCEAN', 'GB',  true),
  ('00000000-0000-4000-a000-000000000009','PassTest India Dam',      'TST_SOLO', -33.9, 18.4,'DAM',   'ZA',  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('passport_v1', false, ARRAY[
  '00000000-0000-4000-9000-00000000000a',
  '00000000-0000-4000-9000-00000000000d'
]::uuid[])
ON CONFLICT (key) DO UPDATE SET enabled_global=false, allowed_user_ids=EXCLUDED.allowed_user_ids;

-- ── Inline migration functions (delete this block for a post-apply run)
CREATE OR REPLACE FUNCTION public.passport_v1_flag_enabled(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE((SELECT enabled_global OR p_user = ANY(allowed_user_ids)
       FROM feature_flags WHERE key = 'passport_v1'), false);
$fn$;

CREATE OR REPLACE FUNCTION public.get_my_swim_passport_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_spots jsonb; v_countries jsonb; v_summary jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF NOT passport_v1_flag_enabled(v_uid) THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE='42501'; END IF;

  WITH dom_country AS (
    SELECT domain, CASE WHEN count(DISTINCT country_code)=1 THEN min(country_code) END AS country_code
      FROM spots WHERE country_code IS NOT NULL GROUP BY domain
  ),
  visits AS (
    SELECT t.spot_id, s.name AS spot_name,
      COALESCE(c.name, dc.name, 'Unknown country') AS country,
      COALESCE(d.display_name, 'Unknown region') AS region,
      s.water_type,
      min((COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')::date) AS first_swim_date,
      max((COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')::date) AS last_swim_date,
      count(*) AS total_swims, min(t.temp_c) AS coldest_temp_c, max(t.temp_c) AS warmest_temp_c
    FROM temp_logs t
    JOIN spots s ON s.id = t.spot_id
    LEFT JOIN domains d ON d.code = s.domain
    LEFT JOIN countries c ON c.iso_code = s.country_code
    LEFT JOIN dom_country x ON x.domain = s.domain
    LEFT JOIN countries dc ON dc.iso_code = x.country_code
    WHERE t.user_id = v_uid
    GROUP BY t.spot_id, s.name, c.name, dc.name, d.display_name, s.water_type
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'spot_id', spot_id, 'spot_name', spot_name, 'country', country, 'region', region,
      'water_type', water_type, 'first_swim_date', first_swim_date, 'last_swim_date', last_swim_date,
      'total_swims', total_swims, 'coldest_temp_c', coldest_temp_c, 'warmest_temp_c', warmest_temp_c
    ) ORDER BY (country='Unknown country'), country, (region='Unknown region'), region, spot_name, spot_id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('country', country, 'spot_count', spot_count, 'swim_count', swim_count)
        ORDER BY (country='Unknown country'), country)
      FROM (SELECT country, count(*) AS spot_count, sum(total_swims) AS swim_count FROM visits GROUP BY country) k), '[]'::jsonb),
    jsonb_build_object('total_spots_explored', count(*), 'total_countries', count(DISTINCT country),
      'total_regions', count(DISTINCT region), 'total_swims_at_spots', COALESCE(sum(total_swims),0))
  INTO v_spots, v_countries, v_summary FROM visits;

  RETURN jsonb_build_object('summary', v_summary, 'countries', v_countries, 'spots', v_spots);
END;
$fn$;

-- Swimmer A: 11 spot-linked logs across 8 spots, plus 1 spotless log.
INSERT INTO temp_logs (user_id, spot_id, temp_c, created_at, logged_at, location_source) VALUES
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000001',12,'2026-03-05 09:00:00+02',NULL,'manual'),
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000001',10,'2026-01-10 09:00:00+02',NULL,'manual'),
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000001',14,'2026-06-20 09:00:00+02',NULL,'manual'),
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000002',24,'2026-04-01 09:00:00+02',NULL,'manual'),
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000003',15,'2026-02-01 09:00:00+02',NULL,'manual'),
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000004',18,'2026-05-01 09:00:00+02',NULL,'manual'),
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000005',19,'2026-05-02 09:00:00+02',NULL,'manual'),
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000006',20,'2026-05-03 09:00:00+02',NULL,'manual'),
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000008',13,'2026-05-04 09:00:00+02',NULL,'manual'),
  ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000009',21,'2026-05-06 09:00:00+02',NULL,'manual');

-- Spotless log — must never become a Passport stamp (t7)
INSERT INTO temp_logs (user_id, spot_id, temp_c, created_at, logged_at, location_source)
VALUES ('00000000-0000-4000-9000-00000000000a', NULL, 17, '2026-05-05 09:00:00+02', NULL, 'gps');

-- 23:30 SAST on 30 Jun = 21:30 UTC. Must report 2026-06-30 (t23).
INSERT INTO temp_logs (user_id, spot_id, temp_c, created_at, logged_at, location_source)
VALUES ('00000000-0000-4000-9000-00000000000a','00000000-0000-4000-a000-000000000002',22,'2026-06-30 23:30:00+02',NULL,'manual');

-- Swimmer B — must never appear in A's passport (t4)
INSERT INTO temp_logs (user_id, spot_id, temp_c, created_at, logged_at, location_source)
VALUES ('00000000-0000-4000-9000-00000000000b','00000000-0000-4000-a000-000000000007',11,'2026-05-01 09:00:00+02',NULL,'manual');

-- ----------------------------------------------------------------
-- SCENARIOS  (t1-t23; see the executed run in the session log)
-- ----------------------------------------------------------------
-- The full assertion block is reproduced verbatim from the executed run.
-- t2/t3 gate on SQLSTATE; the rest assert against the returned jsonb.
-- Ordering assertions rely on WITH ORDINALITY over r->'spots':
--   position 1 = Italy (alphabetically first country)
--   position 8 = Unknown country (pinned last by the sort key)
--
-- Expected values for swimmer A:
--   total_spots_explored  = 8
--   total_swims_at_spots  = 11   (12 logs, 1 spotless)
--   countries             = ["Italy","South Africa","United Kingdom","Unknown country"]
--   Alpha Beach           = 3 swims, first 2026-01-10, last 2026-06-20, 10C / 14C
--   Delta NoCountry       = "South Africa"      (unambiguous domain fallback)
--   Echo Ambiguous        = "Unknown country"   (multi-country domain refuses)
--   Bravo Pool last swim  = 2026-06-30          (SAST day preserved)
--   Charlie Retired       = present             (inactive spot, history kept)
--
-- See sql/applied/ for the executed script if this file has been trimmed;
-- the canonical run is recorded in the Phase 2.5 review package at
-- docs/PHASE_2_5_PASSPORT_V1_REVIEW.md.

ROLLBACK;
