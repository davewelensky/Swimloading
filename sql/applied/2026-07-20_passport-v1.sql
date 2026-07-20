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
-- Migration: 2026-07-20_passport-v1.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Phase 2.5 — Swim Passport V1. Additive-only: the passport_v1 feature
--   flag (Dave, Carina, Johan — off globally) and one read-only RPC,
--   get_my_swim_passport_v1(), answering "where have I swum?" from the
--   caller's OWN existing temp_logs. No new table, column, index,
--   trigger or policy. No writes anywhere. Not a challenge system and
--   not gamification — a private historical record.
--
--   DERIVED, NOT STORED. Every field comes from data that already
--   exists:
--     region  = domains.display_name via spots.domain. `spots` has NO
--               region column; `spots.area` was the alternative and is
--               62% NULL, so domains is the only viable source. Because
--               spots.domain is NOT NULL with zero orphan references,
--               'Unknown region' is unreachable with real data — the
--               branch is a safety net, not an expected state.
--     country = spots.country_code -> countries.name, falling back to
--               the spot's DOMAIN country ONLY where that domain is
--               unambiguous (see the dom_country CTE below).
--
--   WHY THE FALLBACK IS RESTRICTED — this is the subtle one. 27 spots
--   have no country_code, 23 of them with logs. A naive
--   COALESCE(spots.country_code, domains.country_code) resolves all 27,
--   but resolves 7 of them WRONGLY: the EUROPE domain spans CH/IT/PT
--   while domains.country_code says 'CH', so those 7 unknown European
--   spots would each be stamped "Switzerland" — a country invented for
--   a spot that may be anywhere in Europe. The dom_country CTE therefore
--   only trusts a domain that resolves to exactly ONE country. The 20
--   ZA/GB spots get their real country; the 7 European ones honestly
--   read 'Unknown country'. Self-correcting: when the EUROPE domain is
--   split into per-country domains (data-cleanup ticket raised
--   2026-07-20), the fallback starts working with no code change here.
--
--   INACTIVE SPOTS ARE INCLUDED. 32 spots are active=false, and the
--   test cohort has real swims at several (Dalebrook Tidal Pool, Glen
--   Beach, Glencairn Beach). `active` governs whether a spot can be
--   logged to NOW, not whether it was ever swum — excluding them would
--   erase history from a record whose whole purpose is history. Note
--   also that temp_logs.spot_id -> spots is ON DELETE CASCADE, so a
--   hard-deleted spot takes its logs with it and a dangling spot_id
--   cannot exist; "deleted" in practice only ever means inactive.

-- Requested by:
--   Dave (SwimLoading Phase 2.5 kickoff, 2026-07-20)

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM feature_flags WHERE key='passport_v1';  -- expect: 0
-- SELECT count(*) FROM pg_proc WHERE proname IN
--   ('get_my_swim_passport_v1','passport_v1_flag_enabled');    -- expect: 0

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
VALUES ('passport_v1', false, ARRAY[
  'df137255-3add-4153-b368-32e06e2be188',
  'cff2fc33-4a55-451b-8c7f-20f12c1898ce',
  'becb6930-c952-46b0-ae03-741a0721004d'
]::uuid[])
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.passport_v1_flag_enabled(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled_global OR p_user = ANY(allowed_user_ids)
       FROM feature_flags WHERE key = 'passport_v1'),
    false);
$$;

REVOKE ALL ON FUNCTION public.passport_v1_flag_enabled(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.passport_v1_flag_enabled(uuid) TO authenticated;

-- ── 2. get_my_swim_passport_v1 ───────────────────────────────────
-- SECURITY INVOKER — the function can do nothing the caller could not.
--
-- !! SECURITY-CRITICAL !! `WHERE t.user_id = v_uid` below is the ONLY
-- boundary between one swimmer's history and everyone else's. It is NOT
-- a convenience filter. temp_logs RLS does NOT scope reads per user:
--   "Authenticated users can view all temp logs"  USING (auth.role() = 'authenticated')
--   "Public read temp_logs for landing page"      USING (true) TO anon
-- so every authenticated caller can already read every row. Loosening,
-- moving or parameterising that predicate leaks the entire swim history
-- of every swimmer on the platform. Any edit to this function must keep
-- it, and the cross-user test in the acceptance harness must keep
-- passing.
CREATE OR REPLACE FUNCTION public.get_my_swim_passport_v1()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_spots     jsonb;
  v_countries jsonb;
  v_summary   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT passport_v1_flag_enabled(v_uid) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;

  WITH
  -- A domain's country, but ONLY where the domain is unambiguous.
  -- Multi-country domains (EUROPE today) yield NULL rather than a
  -- guess. See the migration header for why this restriction exists.
  dom_country AS (
    SELECT domain,
           CASE WHEN count(DISTINCT country_code) = 1
                THEN min(country_code) END AS country_code
      FROM spots
     WHERE country_code IS NOT NULL
     GROUP BY domain
  ),
  visits AS (
    SELECT
      t.spot_id,
      s.name                                        AS spot_name,
      COALESCE(c.name, dc.name, 'Unknown country')  AS country,
      COALESCE(d.display_name, 'Unknown region')    AS region,
      s.water_type,
      -- SAST dates: a swim logged late evening SAST belongs to that
      -- day, not the UTC day after. Established project convention.
      min((COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')::date) AS first_swim_date,
      max((COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')::date) AS last_swim_date,
      count(*)      AS total_swims,
      min(t.temp_c) AS coldest_temp_c,
      max(t.temp_c) AS warmest_temp_c
    FROM temp_logs t
    -- Inner join: logs with a NULL spot_id are silently excluded here,
    -- which is the specified behaviour — a swim with no recognised spot
    -- is not a Passport stamp.
    JOIN spots s            ON s.id = t.spot_id
    LEFT JOIN domains d     ON d.code = s.domain
    LEFT JOIN countries c   ON c.iso_code = s.country_code
    LEFT JOIN dom_country x ON x.domain = s.domain
    LEFT JOIN countries dc  ON dc.iso_code = x.country_code
    WHERE t.user_id = v_uid          -- !! SECURITY-CRITICAL, see above !!
    GROUP BY t.spot_id, s.name, c.name, dc.name, d.display_name, s.water_type
  )
  SELECT
    -- Spots. Unknown buckets sort LAST rather than alphabetically under
    -- "U" — an unresolved placeholder outranking real places reads as a
    -- bug. spot_id is the final tiebreaker, so ordering is total and
    -- deterministic. Grouping is by spot_id throughout: spots are never
    -- merged by name (and cannot collide anyway — there is a unique
    -- index on lower(spots.name)).
    COALESCE(jsonb_agg(jsonb_build_object(
      'spot_id',         spot_id,
      'spot_name',       spot_name,
      'country',         country,
      'region',          region,
      'water_type',      water_type,
      'first_swim_date', first_swim_date,
      'last_swim_date',  last_swim_date,
      'total_swims',     total_swims,
      'coldest_temp_c',  coldest_temp_c,
      'warmest_temp_c',  warmest_temp_c
    ) ORDER BY (country = 'Unknown country'), country,
               (region  = 'Unknown region'),  region,
               spot_name, spot_id), '[]'::jsonb),

    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'country',    country,
               'spot_count', spot_count,
               'swim_count', swim_count
             ) ORDER BY (country = 'Unknown country'), country)
        FROM (SELECT country, count(*) AS spot_count, sum(total_swims) AS swim_count
                FROM visits GROUP BY country) k
    ), '[]'::jsonb),

    jsonb_build_object(
      'total_spots_explored', count(*),
      'total_countries',      count(DISTINCT country),
      'total_regions',        count(DISTINCT region),
      'total_swims_at_spots', COALESCE(sum(total_swims), 0)
    )
  INTO v_spots, v_countries, v_summary
  FROM visits;

  RETURN jsonb_build_object(
    'summary',   v_summary,
    'countries', v_countries,
    'spots',     v_spots
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_swim_passport_v1() IS
  'Phase 2.5 — the authenticated caller''s own Swim Passport: every spot '
  'they have logged a swim at, grouped by country and region, derived '
  'entirely from existing temp_logs/spots/domains/countries data. '
  'Read-only, no writes, no coordinates, no user_id or temp_log_id in '
  'the response. The WHERE user_id = auth.uid() predicate is the sole '
  'privacy boundary — temp_logs RLS does not scope reads per user.';

REVOKE ALL ON FUNCTION public.get_my_swim_passport_v1() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_swim_passport_v1() TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.get_my_swim_passport_v1();
-- DROP FUNCTION IF EXISTS public.passport_v1_flag_enabled(uuid);
-- DELETE FROM feature_flags WHERE key = 'passport_v1';
-- COMMIT;
-- Additive and read-only, so rollback is total: no data can be left
-- behind. Does NOT alter temp_logs, spots, domains, countries,
-- user_stats, swimmer_achievements, story tables, identity tables,
-- badges, challenges, Strava tables or public_profiles.

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key='passport_v1';
--   -- expect: 1 row, false, {Dave, Carina, Johan}
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('get_my_swim_passport_v1','passport_v1_flag_enabled');  -- expect: 2 rows
