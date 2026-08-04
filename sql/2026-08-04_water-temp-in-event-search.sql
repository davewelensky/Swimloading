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
-- Migration: 2026-08-04_water-temp-in-event-search.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Return water temperature and public interest counts from the event
--   search, so /explore can show them. Both already exist and neither is
--   reachable from the page today:
--     * venue_temp_estimate — 85 of 162 venues now carry a modelled sea
--       temperature (12.3°C to 35.9°C), from venue_water_readings
--     * event_interest_counts — the public "N swimmers interested" signal
--
--   This is the sentence a search engine cannot write: "Sharkfest
--   Alcatraz, 8 August, 15.1°C". It is the whole reason the crawler and
--   the temperature machinery exist.
--
--   Columns are APPENDED to the return shape, never reordered — every
--   existing caller reads results by name and keeps working.
--
--   Honest about coverage, twice over:
--     1. 77 venues have no temperature at all because Open-Meteo Marine
--        models oceans and seas only, so lake and river events return
--        NULL. NULL renders as nothing, never a guess or a zero.
--     2. The temperature is only returned for swims within 14 DAYS.
--        venue_temp_estimate holds TODAY'S reading, which is a fair
--        guide to a swim next weekend and meaningless for one next June.
--        Dave's point — "people will travel to a swim in the correct
--        temp" — is exactly why this must not be fudged: the number has
--        to mean what a swimmer thinks it means.
--
--   The prize is SEASONAL EXPECTED temperature — what that water is
--   typically like on that date, from historical norms — which is what
--   makes the catalogue plannable months ahead. Different dataset
--   (Open-Meteo Archive), different build, deliberately not faked here.

-- Requested by:
--   Dave — 2026-08-04, "linking event_venues.spot_id to real spots
--   remains the highest-value unbuilt thing" → delivered via
--   venue_water_readings, and now surfaced.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   SELECT count(*) FROM venue_temp_estimate WHERE best_c IS NOT NULL;  -- expect 85
--   SELECT count(*) FROM search_event_editions(NULL,NULL,NULL,NULL,NULL,false,NULL,NULL,'date',200); -- 185
--   SELECT pg_get_function_result(oid) FROM pg_proc
--    WHERE proname='search_event_editions';   -- note the current 25 columns

-- ----------------------------------------------------------------
-- BACKUP — not required: replaces one function, changes no data.
-- ----------------------------------------------------------------

BEGIN;

DROP FUNCTION IF EXISTS public.search_event_editions(
  numeric,numeric,integer,date,date,boolean,integer,text,text,integer);

CREATE OR REPLACE FUNCTION public.search_event_editions(
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL, p_radius_km integer DEFAULT NULL,
  p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL, p_weekend_only boolean DEFAULT false,
  p_min_distance_m integer DEFAULT NULL, p_country text DEFAULT NULL,
  p_sort text DEFAULT 'date', p_limit integer DEFAULT 60
)
RETURNS TABLE (
  edition_id uuid, title text, series_name text, prominence text,
  start_date date, end_date date, date_precision text, date_confirmed boolean,
  status text, registration_status text, registration_url text, official_url text,
  venue_name text, city text, region text, country_code text,
  latitude numeric, longitude numeric, distance_km numeric,
  participant_estimate integer, organiser_name text, distances jsonb, max_distance_m integer,
  verification_tier text, confidence_score smallint,
  water_temp_c numeric, water_confidence text, interested_count bigint
)
LANGUAGE sql STABLE SET search_path = public
AS $fn$
  WITH base AS (
    SELECT e.id, e.title, s.display_name AS series_name, s.prominence,
      e.start_date, e.end_date, e.date_precision, e.date_confirmed,
      e.status, e.registration_status, e.registration_url, e.official_url,
      v.display_name AS venue_name, v.city, v.region, v.country_code,
      v.latitude, v.longitude, e.participant_estimate, o.display_name AS organiser_name,
      e.verification_tier, e.confidence_score,
      -- ONLY for swims in the near term. venue_temp_estimate holds
      -- TODAY'S modelled sea temperature; it is a fair guide to a swim
      -- four days out and meaningless for one eleven months away.
      -- Showing today's 15°C beside a June 2027 swim would be actively
      -- misleading, and people are going to book travel on this number.
      -- Seasonal expected temperature — what that water is typically like
      -- on that date — is a different dataset and a separate build.
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
    LEFT JOIN venue_temp_estimate vte ON vte.venue_id = v.id
    LEFT JOIN event_interest_counts ic ON ic.edition_id = e.id
    WHERE e.status NOT IN ('cancelled','completed')
      AND e.start_date IS NOT NULL
      -- The date floor that makes the past unreachable, even if a caller
      -- passes an explicit past p_date_from.
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
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$fn$;

GRANT EXECUTE ON FUNCTION public.search_event_editions(
  numeric,numeric,integer,date,date,boolean,integer,text,text,integer) TO anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- Re-apply the function body from
-- sql/applied/2026-08-04_publish-with-verification-tier.sql (25 columns,
-- without water temperature or interest counts).

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM search_event_editions(NULL,NULL,NULL,NULL,NULL,false,NULL,NULL,'date',200);
--   -- expect 185, unchanged
-- SELECT title, city, start_date, water_temp_c, water_confidence
--   FROM search_event_editions(NULL,NULL,NULL,NULL,NULL,false,NULL,'US','date',6);
--   -- expect temperatures on coastal swims, NULL on inland ones
-- SELECT count(*) FILTER (WHERE water_temp_c IS NOT NULL) AS with_temp,
--        count(*) FILTER (WHERE water_temp_c IS NULL)     AS without
--   FROM search_event_editions(NULL,NULL,NULL,NULL,NULL,false,NULL,NULL,'date',200);
--   -- with_temp counts only near-term coastal swims, NOT all 85 venues
--   -- that have a reading. A far-future swim correctly shows nothing.
