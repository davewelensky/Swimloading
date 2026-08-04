-- ================================================================
-- SwimLoading — Migration Template
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-04_raise-explore-result-ceiling.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   /explore was reporting "200 swims listed, 22 countries". Both numbers
--   were wrong: there are 208 live upcoming editions across 24 countries.
--
--   search_event_editions ends with `LIMIT GREATEST(1, LEAST(p_limit,
--   200))`. The catalogue crossed 200 today as the AI-extraction sweep
--   published new events, so the ceiling started truncating — and because
--   the cut happens in DATE order, it removed the furthest-out events,
--   which is how two countries vanished from a count the page presents as
--   fact. Showing fewer cards would be tolerable; reporting the wrong
--   number of countries is not.
--
--   Raised to 1000. explore.html's own LIMIT moves to 1000 in the same
--   ship — the lower of the two wins silently, so they must move together.
--
--   1000 is a stopgap, deliberately. /explore loads every upcoming swim
--   once and filters client-side because the map's list follows the
--   viewport, and a server round-trip per pan would be unusable. That
--   design has a ceiling of its own: past a few thousand events the page
--   needs server-side bounding-box queries instead. At the current rate
--   (208 published, 134 candidates still pending) that is months away, not
--   years — this buys time, it does not solve it.
--
--   Cost of the raise is small because the expensive part of the function
--   is the one-time temps CTE, not the per-row work: measured 42 ms at 200
--   rows immediately after the timeout fix earlier today.

-- Requested by:
--   Dave — 2026-08-04, "do we only have 200 swims listed in total?"

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   -- The truncation, demonstrated: the function returns exactly the cap
--   -- while the table holds more.
--   SELECT count(*) FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',200);
--   -- expect 200 (the ceiling)
--   SELECT count(*) FROM event_editions
--    WHERE status NOT IN ('cancelled','completed') AND start_date IS NOT NULL
--      AND COALESCE(end_date, start_date) >= current_date;
--   -- expect 208 (the truth)
--
--   -- The countries the cap is hiding:
--   SELECT count(DISTINCT v.country_code) FROM event_editions e
--     JOIN event_venues v ON v.id = e.venue_id
--    WHERE e.status NOT IN ('cancelled','completed')
--      AND COALESCE(e.end_date, e.start_date) >= current_date AND v.country_code IS NOT NULL;
--   -- expect 24, against the 22 the page was showing

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- Not required: this changes one integer in a STABLE function body and
-- touches no data. The rollback is the same statement with 200.

BEGIN;

-- Only the final LIMIT changes. Everything else is byte-for-byte the
-- definition applied earlier today in
-- 2026-08-04_fix-explore-search-timeout.sql, including the MATERIALIZED
-- CTE — dropping that would reintroduce the statement timeout, and at
-- 1000 rows it would be five times worse.
CREATE OR REPLACE FUNCTION public.search_event_editions(
  p_lat numeric DEFAULT NULL::numeric,
  p_lng numeric DEFAULT NULL::numeric,
  p_radius_km integer DEFAULT NULL::integer,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_weekend_only boolean DEFAULT false,
  p_min_distance_m integer DEFAULT NULL::integer,
  p_country text DEFAULT NULL::text,
  p_sort text DEFAULT 'date'::text,
  p_limit integer DEFAULT 60)
RETURNS TABLE(edition_id uuid, title text, series_name text, prominence text,
  start_date date, end_date date, date_precision text, date_confirmed boolean,
  status text, registration_status text, registration_url text, official_url text,
  venue_name text, city text, region text, country_code text,
  latitude numeric, longitude numeric, distance_km numeric,
  participant_estimate integer, organiser_name text, distances jsonb,
  max_distance_m integer, verification_tier text, confidence_score smallint,
  water_temp_c numeric, water_confidence text, interested_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- MATERIALIZED is load-bearing, not a style choice. Without it the
  -- planner re-runs venue_temp_estimate (and the DISTINCT ON over every
  -- row of spot_water_readings inside it) once per output row — 297k
  -- buffers instead of 25k, and a statement timeout on /explore.
  WITH temps AS MATERIALIZED (
    SELECT vte.venue_id, vte.best_c, vte.confidence
      FROM venue_temp_estimate vte
  ),
  base AS (
    SELECT e.id, e.title, s.display_name AS series_name, s.prominence,
      e.start_date, e.end_date, e.date_precision, e.date_confirmed,
      e.status, e.registration_status, e.registration_url, e.official_url,
      v.display_name AS venue_name, v.city, v.region, v.country_code,
      v.latitude, v.longitude, e.participant_estimate, o.display_name AS organiser_name,
      e.verification_tier, e.confidence_score,
      CASE WHEN e.start_date <= current_date + 14 THEN round(vte.best_c, 1) END AS water_temp_c,
      CASE WHEN e.start_date <= current_date + 14 THEN vte.confidence END      AS water_confidence,
      COALESCE(ic.interested, 0) AS interested_count,
      CASE WHEN p_lat IS NULL OR p_lng IS NULL OR v.latitude IS NULL THEN NULL
        ELSE round((6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat))*cos(radians(v.latitude))*cos(radians(v.longitude)-radians(p_lng))
            + sin(radians(p_lat))*sin(radians(v.latitude))))))::numeric, 1) END AS distance_km
    FROM event_editions e
    JOIN event_series s ON s.id = e.series_id
    LEFT JOIN event_venues v ON v.id = e.venue_id
    LEFT JOIN public_organisers o ON o.id = s.organiser_id
    LEFT JOIN temps vte ON vte.venue_id = v.id
    LEFT JOIN event_interest_counts ic ON ic.edition_id = e.id
    WHERE e.status NOT IN ('cancelled','completed')
      AND e.start_date IS NOT NULL
      AND COALESCE(e.end_date, e.start_date) >= GREATEST(COALESCE(p_date_from, current_date), current_date)
      AND (p_date_to IS NULL OR e.start_date <= p_date_to)
      AND (NOT p_weekend_only OR EXTRACT(DOW FROM e.start_date) IN (0,6))
      AND (p_country IS NULL OR v.country_code = upper(p_country))
      AND (p_min_distance_m IS NULL OR EXISTS (
            SELECT 1 FROM event_distances d WHERE d.edition_id=e.id AND d.distance_metres >= p_min_distance_m))
  )
  SELECT b.id, b.title, b.series_name, b.prominence, b.start_date, b.end_date,
    b.date_precision, b.date_confirmed, b.status, b.registration_status,
    b.registration_url, b.official_url, b.venue_name, b.city, b.region, b.country_code,
    b.latitude, b.longitude, b.distance_km, b.participant_estimate, b.organiser_name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label',d.original_label,'metres',d.distance_metres,
              'start_time',d.start_time,'wetsuit',d.wetsuit_policy) ORDER BY d.distance_metres NULLS LAST)
       FROM event_distances d WHERE d.edition_id=b.id), '[]'::jsonb),
    (SELECT max(d.distance_metres) FROM event_distances d WHERE d.edition_id=b.id),
    b.verification_tier, b.confidence_score,
    b.water_temp_c, b.water_confidence, b.interested_count
  FROM base b
  WHERE p_radius_km IS NULL OR (b.distance_km IS NOT NULL AND b.distance_km <= p_radius_km)
  ORDER BY
    CASE WHEN p_sort='prominence' THEN array_position(ARRAY['iconic','major','regional','local','unknown'], b.prominence) END,
    CASE WHEN p_sort='prominence' THEN b.participant_estimate END DESC NULLS LAST,
    CASE WHEN p_sort='distance' THEN b.distance_km END NULLS LAST,
    b.start_date NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$function$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- Re-apply the identical body with `LEAST(p_limit, 200)` on the last line.
-- Note this reinstates the under-count, so roll back only if 1000 rows
-- causes a problem on the client rather than to "restore" anything.

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- The count now matches the table rather than the ceiling:
-- SELECT count(*) FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',1000);
-- -- expect 208, matching the pre-check's true count
--
-- And every country is present:
-- SELECT count(DISTINCT country_code) FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',1000);
-- -- expect 24
--
-- Still fast — the temps CTE is one-time, so more rows cost little:
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',1000);
-- -- expect well under 100 ms
--
-- A caller asking for less still gets less (the cap is a ceiling, not a floor):
-- SELECT count(*) FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',10);  -- expect 10
