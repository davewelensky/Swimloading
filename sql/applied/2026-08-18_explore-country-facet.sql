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
-- Migration: 2026-08-18_explore-country-facet.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Add explore_country_facet() — a per-country count of the swims matching
--   the CURRENT search filters, so /explore can answer "I want 5 km swims,
--   where in the world are they?". The country chips on that page are today
--   fed by /api/explore/map-points, which is unfiltered: filtering to 5 km
--   leaves them reading "France 40" when 40 is France's total across every
--   distance. This replaces a wrong number with a right one.

-- Requested by:
--   Dave — "she selects 5km swims and wants to see the filter of all the
--   possible 5km swims coming up, then maybe say ooh, france looks good"

-- Design notes:
--   * The WHERE clause is a deliberate, literal copy of search_events_v2's
--     `base` CTE. If you change the filters in one, change them in both —
--     test/explore-country-facet.test.js fails when they disagree, which is
--     the only thing standing between this and a facet that quietly lies.
--   * p_country is NOT a parameter. A facet must not filter by its own
--     dimension, or picking France returns "France" as the only option and
--     the swimmer can never see what else was available.
--   * No scoring, no temps join, no distances aggregation: this counts rows,
--     and none of that changes which rows there are.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Purely additive: creates one new function, touches no rows and no
-- existing object. Expected results are noted against each.
--
--   -- 1. The name is free (expect 0):
--   SELECT count(*) FROM pg_proc WHERE proname = 'explore_country_facet';
--
--   -- 2. The function this mirrors still exists (expect 1):
--   SELECT count(*) FROM pg_proc WHERE proname = 'search_events_v2';
--
--   -- 3. The number the facet must agree with, unfiltered (expect ~305):
--   SELECT count(*) FROM event_editions e
--    WHERE e.is_searchable
--      AND e.status NOT IN ('cancelled','completed')
--      AND e.start_date IS NOT NULL
--      AND COALESCE(e.end_date, e.start_date) >= current_date
--      AND COALESCE(e.discipline,'open_water') <> 'multisport_swim_leg';

-- ----------------------------------------------------------------
-- BACKUP — not required: this migration creates a new function and
-- performs no DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.explore_country_facet(
  p_lat                numeric  DEFAULT NULL,
  p_lng                numeric  DEFAULT NULL,
  p_radius_km          integer  DEFAULT NULL,
  p_date_from          date     DEFAULT NULL,
  p_date_to            date     DEFAULT NULL,
  p_min_distance_m     integer  DEFAULT NULL,
  p_water_type         text     DEFAULT NULL,
  p_weekend_only       boolean  DEFAULT false,
  p_entries_open       boolean  DEFAULT false,
  p_confirmed_only     boolean  DEFAULT false,
  p_featured           boolean  DEFAULT false,
  p_include_multisport boolean  DEFAULT false
)
RETURNS TABLE (
  country_code text,
  n            bigint,
  next_date    date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH base AS (
    SELECT
      v.country_code,
      e.start_date,
      CASE WHEN p_lat IS NULL OR p_lng IS NULL OR v.latitude IS NULL THEN NULL
        ELSE round((6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat))*cos(radians(v.latitude))*cos(radians(v.longitude)-radians(p_lng))
            + sin(radians(p_lat))*sin(radians(v.latitude))))))::numeric, 1) END AS distance_km
    FROM event_editions e
    JOIN event_series s      ON s.id = e.series_id
    LEFT JOIN event_venues v ON v.id = e.venue_id
    -- ↓↓ Copied verbatim from search_events_v2's `base`. Keep in step. ↓↓
    WHERE e.is_searchable
      AND e.status NOT IN ('cancelled','completed')
      AND e.start_date IS NOT NULL
      AND COALESCE(e.end_date, e.start_date) >= GREATEST(COALESCE(p_date_from, current_date), current_date)
      AND (p_date_to        IS NULL OR e.start_date <= p_date_to)
      AND (p_water_type     IS NULL OR v.water_body_type = p_water_type)
      AND (NOT p_weekend_only   OR EXTRACT(DOW FROM e.start_date) IN (0,6))
      AND (NOT p_entries_open   OR e.registration_status = 'open')
      AND (NOT p_confirmed_only OR e.date_confirmed)
      AND (NOT p_featured       OR e.is_featured)
      AND (p_include_multisport OR COALESCE(e.discipline,'open_water') <> 'multisport_swim_leg')
      AND (p_min_distance_m IS NULL OR EXISTS (
            SELECT 1 FROM event_distances d
             WHERE d.edition_id = e.id AND d.distance_metres >= p_min_distance_m))
    -- ↑↑ End of the copied block. ↑↑
  ),
  filtered AS (
    SELECT * FROM base b
     WHERE p_radius_km IS NULL
        OR (b.distance_km IS NOT NULL AND b.distance_km <= p_radius_km)
  )
  -- A row can lack a country two ways: no venue at all (21 on 2026-08-18),
  -- or a venue whose country_code is unset (11). Both are still real swims
  -- and are still counted by the search, so they are simply absent here
  -- rather than bucketed as "Unknown" — a chip a swimmer cannot usefully
  -- click. /api/explore/events reports the shortfall as `without_country`,
  -- derived from the totals so it covers both causes.
  SELECT f.country_code, count(*) AS n, min(f.start_date) AS next_date
    FROM filtered f
   WHERE f.country_code IS NOT NULL
   GROUP BY f.country_code
   ORDER BY count(*) DESC, f.country_code;
$fn$;

COMMENT ON FUNCTION public.explore_country_facet IS
  'Per-country counts for the current /explore filters. Mirrors search_events_v2 base filters; no p_country by design (a facet must not filter its own dimension). Kept honest by test/explore-country-facet.test.js.';

GRANT EXECUTE ON FUNCTION public.explore_country_facet TO anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DROP FUNCTION IF EXISTS public.explore_country_facet(
--     numeric, numeric, integer, date, date, integer, text,
--     boolean, boolean, boolean, boolean, boolean);
--   -- /api/explore/events degrades to omitting `facets` (the browser
--   -- already treats a missing facet as "show no destination row").

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- 1. It exists and anon may call it (expect 1 row, true):
--   SELECT proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_call
--     FROM pg_proc p WHERE proname = 'explore_country_facet';
--
--   -- 2. Facet total == search total, unfiltered (expect equal):
--   SELECT (SELECT sum(n) FROM explore_country_facet())                        AS facet_total,
--          (SELECT max(total_count) FROM search_events_v2(p_page_size => 1))   AS search_total;
--   -- APPLIED 2026-08-18: facet_total 273, search_total 305. The 32-row gap
--   -- is 21 swims with no venue plus 11 with a venue and no country_code:
--   SELECT count(*) FILTER (WHERE e.venue_id IS NULL)                             AS no_venue,
--          count(*) FILTER (WHERE e.venue_id IS NOT NULL AND v.country_code IS NULL) AS venue_no_country
--     FROM event_editions e
--     LEFT JOIN event_venues v ON v.id = e.venue_id
--    WHERE e.is_searchable AND e.status NOT IN ('cancelled','completed')
--      AND e.start_date IS NOT NULL
--      AND COALESCE(e.end_date, e.start_date) >= current_date
--      AND COALESCE(e.discipline,'open_water') <> 'multisport_swim_leg';
--
--   -- 3. Same, filtered to 5 km + weekends (Carina's search) — expect equal:
--   SELECT (SELECT sum(n) FROM explore_country_facet(
--             p_min_distance_m => 5000, p_weekend_only => true))               AS facet_total,
--          (SELECT max(total_count) FROM search_events_v2(
--             p_min_distance_m => 5000, p_weekend_only => true, p_page_size => 1)) AS search_total;
--
--   -- 4. The answer to "where are the 5 km swims" (expect a ranked list):
--   SELECT * FROM explore_country_facet(p_min_distance_m => 5000) LIMIT 10;
