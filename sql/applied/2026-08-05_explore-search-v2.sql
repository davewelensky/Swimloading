-- ================================================================
-- SwimLoading — Migration
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-05_explore-search-v2.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ✅ APPLIED 2026-08-05. All 9 verify checks passed: both
--            functions coexist; anon can execute; 5 rows / 250 total;
--            pages 1+2 gave 10 rows / 10 distinct (no overlap or skip);
--            min(page 1 score) >= max(page 2 score) so ranking precedes
--            LIMIT; page_size 100000 clamped to 60; weekend, distance,
--            country, radius and multisport filters all leaked 0 rows.
-- ================================================================

-- Purpose:
--   Stage 3 of the Explore Phase 1 brief: one validated, paginated,
--   deterministically-ranked search that /api/explore/events calls.
--
--   ADDITIVE. search_event_editions is NOT touched — explore.html calls it
--   today and must keep working while the new interface is built beside it.
--   Two functions briefly coexist on purpose; the old one is retired in a
--   later stage once nothing calls it.
--
--   Why the ranking lives HERE and not in the API route: ranking has to be
--   applied BEFORE the LIMIT, or page 2 is not the second-best ten results,
--   it is ten arbitrary rows re-sorted. Sorting after pagination is the
--   classic version of this bug and it is invisible on page 1.
--
--   Why match_reasons are NOT built here: they are user-facing prose that
--   changes with copy edits and needs the caller's locale and search
--   context. The function returns the FACTS the reasons are derived from
--   (distance_km, matched_distance_m, is_weekend, entries_open,
--   verification_tier), and api/explore/events.js phrases them. Facts in
--   SQL, wording in the API.
--
--   The scoring is plain arithmetic over named columns. No LLM, ever —
--   same rule as discovery-worker/src/confidence/rules.ts.

-- Requested by:
--   Dave — 2026-08-05, Explore Phase 1 brief §5 and §6.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. The new function must not already exist (expect 0):
--      SELECT count(*) FROM pg_proc WHERE proname='search_events_v2';
--
-- 2. The function this one must NOT disturb is still present and still
--    executable by anon.
--
--    USE has_function_privilege, NOT information_schema.routine_privileges.
--    routine_privileges reports only grants the CURRENT role is party to, so
--    it returned 0 rows for search_event_editions on 2026-08-05 while anon
--    could in fact execute it perfectly well. Reading that 0 as "the grant is
--    missing" would send you chasing a production bug that does not exist —
--    or worse, re-granting and assuming you fixed something.
--      SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ok,
--             array_to_string(p.proacl,' | ')                  AS acl
--        FROM pg_proc p WHERE p.proname='search_event_editions';
--      -- ACTUAL 2026-08-05: anon_ok = true, acl contains anon=X/postgres
--
-- 3. Supporting views this function reads must exist (expect 3):
--      SELECT count(*) FROM information_schema.views WHERE table_schema='public'
--       AND table_name IN ('venue_temp_estimate','event_interest_counts','public_organisers');
--
-- 4. Baseline result count for the VERIFY comparison:
--      SELECT count(*) FROM event_editions
--       WHERE status NOT IN ('cancelled','completed') AND start_date >= current_date;

-- ----------------------------------------------------------------
-- BACKUP — not required. Creates one new function. Writes no rows,
-- alters no table, replaces nothing.
-- ----------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.search_events_v2(
  p_lat                numeric  DEFAULT NULL,
  p_lng                numeric  DEFAULT NULL,
  p_radius_km          integer  DEFAULT NULL,
  p_country            text     DEFAULT NULL,
  p_region             text     DEFAULT NULL,
  p_date_from          date     DEFAULT NULL,
  p_date_to            date     DEFAULT NULL,
  p_min_distance_m     integer  DEFAULT NULL,
  p_water_type         text     DEFAULT NULL,
  p_weekend_only       boolean  DEFAULT false,
  p_entries_open       boolean  DEFAULT false,
  p_confirmed_only     boolean  DEFAULT false,
  p_featured           boolean  DEFAULT false,
  p_include_multisport boolean  DEFAULT false,
  p_sort               text     DEFAULT 'relevance',
  p_page               integer  DEFAULT 1,
  p_page_size          integer  DEFAULT 20
)
RETURNS TABLE (
  edition_id uuid, slug text, title text, series_name text, prominence text,
  start_date date, end_date date, date_precision text, date_confirmed boolean,
  status text, registration_status text, registration_url text, official_url text,
  venue_name text, city text, region text, country_code text, water_body_type text,
  latitude numeric, longitude numeric, distance_km numeric,
  participant_estimate integer, organiser_name text,
  distances jsonb, max_distance_m integer, matched_distance_m integer,
  verification_tier text, confidence_score smallint, last_verified_at timestamptz,
  officially_claimed boolean, water_temp_c numeric, water_confidence text,
  interested_count bigint, discipline text, is_featured boolean,
  is_weekend boolean, entries_open boolean,
  rank_score integer, total_count bigint
)
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  -- MATERIALIZED is load-bearing. Without it the planner re-runs the whole
  -- venue_temp_estimate view once per output row: 297,553 buffers / 507 ms
  -- for 192 rows, measured 2026-08-04. With it, 25 ms. Compare BUFFERS, not
  -- milliseconds — the first call after a recreate is plan-cache warm-up.
  WITH temps AS MATERIALIZED (
    SELECT vte.venue_id, vte.best_c, vte.confidence FROM venue_temp_estimate vte
  ),
  base AS (
    SELECT
      e.id, e.slug, e.title, s.display_name AS series_name, s.prominence,
      e.start_date, e.end_date, e.date_precision, e.date_confirmed,
      e.status, e.registration_status, e.registration_url, e.official_url,
      v.display_name AS venue_name, v.city, v.region, v.country_code,
      v.water_body_type, v.latitude, v.longitude,
      e.participant_estimate, o.display_name AS organiser_name,
      e.verification_tier, e.confidence_score, e.last_verified_at,
      e.officially_claimed, e.discipline, e.is_featured,
      -- Temperature is shown only within 14 days: it is today's water, a
      -- fair guide to next weekend and meaningless for a swim months out.
      CASE WHEN e.start_date <= current_date + 14 THEN round(vte.best_c, 1) END AS water_temp_c,
      CASE WHEN e.start_date <= current_date + 14 THEN vte.confidence END      AS water_confidence,
      COALESCE(ic.interested, 0) AS interested_count,
      (EXTRACT(DOW FROM e.start_date) IN (0,6))            AS is_weekend,
      (e.registration_status = 'open')                     AS entries_open,
      (SELECT max(d.distance_metres) FROM event_distances d WHERE d.edition_id = e.id) AS max_distance_m,
      -- The SHORTEST distance that still satisfies the request: what the
      -- swimmer would actually enter, not the longest the event offers.
      (SELECT min(d.distance_metres) FROM event_distances d
        WHERE d.edition_id = e.id
          AND (p_min_distance_m IS NULL OR d.distance_metres >= p_min_distance_m)) AS matched_distance_m,
      CASE WHEN p_lat IS NULL OR p_lng IS NULL OR v.latitude IS NULL THEN NULL
        ELSE round((6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat))*cos(radians(v.latitude))*cos(radians(v.longitude)-radians(p_lng))
            + sin(radians(p_lat))*sin(radians(v.latitude))))))::numeric, 1) END AS distance_km
    FROM event_editions e
    JOIN event_series s        ON s.id = e.series_id
    LEFT JOIN event_venues v   ON v.id = e.venue_id
    LEFT JOIN public_organisers o ON o.id = s.organiser_id
    LEFT JOIN temps vte        ON vte.venue_id = v.id
    LEFT JOIN event_interest_counts ic ON ic.edition_id = e.id
    WHERE e.is_searchable
      AND e.status NOT IN ('cancelled','completed')
      AND e.start_date IS NOT NULL
      -- An event running today is still on; compare against end_date.
      AND COALESCE(e.end_date, e.start_date) >= GREATEST(COALESCE(p_date_from, current_date), current_date)
      AND (p_date_to        IS NULL OR e.start_date <= p_date_to)
      AND (p_country        IS NULL OR v.country_code = upper(p_country))
      AND (p_region         IS NULL OR v.region = p_region)
      AND (p_water_type     IS NULL OR v.water_body_type = p_water_type)
      AND (NOT p_weekend_only   OR EXTRACT(DOW FROM e.start_date) IN (0,6))
      AND (NOT p_entries_open   OR e.registration_status = 'open')
      AND (NOT p_confirmed_only OR e.date_confirmed)
      AND (NOT p_featured       OR e.is_featured)
      -- Default to open water. A NULL discipline is treated as open water
      -- rather than hidden, so a row written before that column existed can
      -- never silently vanish.
      AND (p_include_multisport OR COALESCE(e.discipline,'open_water') <> 'multisport_swim_leg')
      AND (p_min_distance_m IS NULL OR EXISTS (
            SELECT 1 FROM event_distances d
             WHERE d.edition_id = e.id AND d.distance_metres >= p_min_distance_m))
  ),
  -- Radius is applied AFTER distance_km is computed, and before scoring, so
  -- the score is only ever calculated over rows that survive the filter.
  filtered AS (
    SELECT * FROM base b
     WHERE p_radius_km IS NULL
        OR (b.distance_km IS NOT NULL AND b.distance_km <= p_radius_km)
  ),
  scored AS (
    SELECT f.*,
      (
        -- ── Proximity, 0-30. Only scores when the search had a location.
        CASE
          WHEN f.distance_km IS NULL THEN 0
          WHEN f.distance_km <=  25 THEN 30
          WHEN f.distance_km <=  50 THEN 26
          WHEN f.distance_km <= 100 THEN 21
          WHEN f.distance_km <= 200 THEN 15
          WHEN f.distance_km <= 400 THEN 8
          ELSE 3
        END
        -- ── Date proximity, 0-20. Soon is more useful than far off, but a
        --    swim next week may be too late to enter, so 2-8 weeks peaks.
        + CASE
            WHEN f.start_date <= current_date + 14  THEN 14
            WHEN f.start_date <= current_date + 56  THEN 20
            WHEN f.start_date <= current_date + 120 THEN 16
            WHEN f.start_date <= current_date + 240 THEN 10
            ELSE 5
          END
        -- ── Distance match, 0-12.
        + CASE
            WHEN p_min_distance_m IS NULL THEN 6
            WHEN f.matched_distance_m IS NOT NULL THEN 12
            ELSE 0
          END
        -- ── How well we verified it, 0-18. The same signal the card shows,
        --    so the ranking cannot contradict the badge next to it.
        + CASE f.verification_tier
            WHEN 'confirmed'  THEN 18
            WHEN 'listed'     THEN 11
            WHEN 'unverified' THEN 3
            ELSE 0
          END
        + CASE WHEN f.officially_claimed THEN 6 ELSE 0 END
        -- ── Can you actually enter it, 0-8.
        + CASE f.registration_status
            WHEN 'open'     THEN 8
            WHEN 'sold_out' THEN 2
            WHEN 'closed'   THEN 0
            ELSE 4
          END
        -- ── Stature, 0-10. Iconic swims are why someone travels.
        + CASE f.prominence
            WHEN 'iconic'   THEN 10
            WHEN 'major'    THEN 7
            WHEN 'regional' THEN 4
            WHEN 'local'    THEN 2
            ELSE 0
          END
        + CASE WHEN f.is_featured THEN 6 ELSE 0 END
        -- ── Completeness, 0-6. A listing you can act on beats a stub.
        + CASE WHEN f.registration_url IS NOT NULL THEN 3 ELSE 0 END
        + CASE WHEN f.max_distance_m   IS NOT NULL THEN 2 ELSE 0 END
        + CASE WHEN f.date_confirmed               THEN 1 ELSE 0 END
      )::integer AS rank_score
    FROM filtered f
  )
  SELECT
    sc.id, sc.slug, sc.title, sc.series_name, sc.prominence,
    sc.start_date, sc.end_date, sc.date_precision, sc.date_confirmed,
    sc.status, sc.registration_status, sc.registration_url, sc.official_url,
    sc.venue_name, sc.city, sc.region, sc.country_code, sc.water_body_type,
    sc.latitude, sc.longitude, sc.distance_km,
    sc.participant_estimate, sc.organiser_name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'label', d.original_label, 'metres', d.distance_metres,
                'category', d.category, 'start_time', d.start_time,
                'wetsuit', d.wetsuit_policy)
              ORDER BY d.distance_metres NULLS LAST)
       FROM event_distances d WHERE d.edition_id = sc.id), '[]'::jsonb),
    sc.max_distance_m, sc.matched_distance_m,
    sc.verification_tier, sc.confidence_score, sc.last_verified_at,
    sc.officially_claimed, sc.water_temp_c, sc.water_confidence,
    sc.interested_count, sc.discipline, sc.is_featured,
    sc.is_weekend, sc.entries_open,
    sc.rank_score,
    -- Total BEFORE pagination, so the caller can render "page 2 of 9"
    -- without a second round trip.
    count(*) OVER () AS total_count
  FROM scored sc
  ORDER BY
    CASE WHEN p_sort = 'date'       THEN sc.start_date END ASC  NULLS LAST,
    CASE WHEN p_sort = 'distance'   THEN sc.distance_km END ASC NULLS LAST,
    CASE WHEN p_sort = 'relevance'  THEN sc.rank_score END DESC NULLS LAST,
    CASE WHEN p_sort = 'prominence'
         THEN array_position(ARRAY['iconic','major','regional','local','unknown'], sc.prominence) END ASC,
    -- Deterministic tiebreak. Without a unique final key, two rows with an
    -- identical score can swap between pages and a result appears twice.
    sc.start_date ASC NULLS LAST, sc.id ASC
  -- Hard ceilings enforced here as well as in the API: this function is
  -- callable directly with the anon key, so the API's validation is a
  -- convenience, not the boundary.
  LIMIT  LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 60)
  OFFSET LEAST(GREATEST(COALESCE(p_page, 1), 1) - 1, 500)
         * LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 60);
$fn$;

COMMENT ON FUNCTION public.search_events_v2 IS
  'Explore Phase 1 search. Validated, filtered, deterministically ranked and '
  'paginated. Ranking is arithmetic over named columns — never an LLM — and '
  'is applied before LIMIT so page N is genuinely the Nth page of the '
  'ranking. Returns the facts behind the ranking (distance_km, '
  'matched_distance_m, is_weekend, entries_open, verification_tier) so the '
  'API can phrase match_reasons without recomputing anything.';

-- Public search must work with no login, exactly as it does today.
GRANT EXECUTE ON FUNCTION public.search_events_v2(
  numeric,numeric,integer,text,text,date,date,integer,text,
  boolean,boolean,boolean,boolean,boolean,text,integer,integer) TO anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo.
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.search_events_v2(
--   numeric,numeric,integer,text,text,date,date,integer,text,
--   boolean,boolean,boolean,boolean,boolean,text,integer,integer);
-- COMMIT;
-- Nothing else is affected: search_event_editions and explore.html are
-- untouched by this migration, so rolling back returns Explore to exactly
-- its current behaviour.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. Exists, and the old one still does:
--      SELECT proname FROM pg_proc
--       WHERE proname IN ('search_events_v2','search_event_editions');  -- expect 2
--
-- 2. Callable by anon (public search must not require a login). Again,
--    has_function_privilege — see pre-check 2 for why not routine_privileges:
--      SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
--        FROM pg_proc p WHERE p.proname='search_events_v2';              -- expect true
--
-- 3. Returns rows, and total_count is the pre-pagination total:
--      SELECT count(*) AS on_page, max(total_count) AS total
--        FROM search_events_v2(p_page_size => 5);
--      -- expect on_page = 5, total = the full upcoming searchable count
--
-- 4. Pagination does not repeat or skip a row:
--      SELECT count(*) AS should_be_10, count(DISTINCT edition_id) AS distinct_10
--        FROM (SELECT edition_id FROM search_events_v2(p_page=>1,p_page_size=>5)
--              UNION ALL
--              SELECT edition_id FROM search_events_v2(p_page=>2,p_page_size=>5)) x;
--      -- expect both 10
--
-- 5. Ranking is applied before the limit — page 1 scores >= page 2:
--      SELECT (SELECT min(rank_score) FROM search_events_v2(p_page=>1,p_page_size=>10))
--          >= (SELECT max(rank_score) FROM search_events_v2(p_page=>2,p_page_size=>10)) AS ordered;
--      -- expect true
--
-- 6. Page size cannot be abused:
--      SELECT count(*) FROM search_events_v2(p_page_size => 100000);     -- expect <= 60
--
-- 7. Filters actually filter:
--      SELECT count(*) FROM search_events_v2(p_weekend_only => true)
--       WHERE NOT is_weekend;                                            -- expect 0
--      SELECT count(*) FROM search_events_v2(p_min_distance_m => 10000)
--       WHERE max_distance_m < 10000;                                    -- expect 0
--      SELECT count(*) FROM search_events_v2(p_country => 'za')
--       WHERE country_code <> 'ZA';                                      -- expect 0
--
-- 8. Radius filter is honest about its centre:
--      SELECT count(*) FROM search_events_v2(
--        p_lat=>-33.9, p_lng=>18.4, p_radius_km=>100) WHERE distance_km > 100;  -- expect 0
--
-- 9. Performance — compare BUFFERS, not ms:
--      EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM search_events_v2(p_page_size=>20);
--      -- the temps CTE must appear ONCE, not once per row
