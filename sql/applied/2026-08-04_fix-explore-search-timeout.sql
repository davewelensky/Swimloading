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
-- Migration: 2026-08-04_fix-explore-search-timeout.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Stop /explore timing out. Live symptom, reported 2026-08-04:
--   "Could not load the swims. canceling statement due to statement
--   timeout" — intermittently, hence loading in Safari but not Chrome.
--
--   Cause, measured rather than guessed. search_event_editions has:
--
--       LEFT JOIN venue_temp_estimate vte ON vte.venue_id = v.id
--
--   venue_temp_estimate is a view over another view (spot_temp_estimate),
--   which does a DISTINCT ON across the whole of spot_water_readings. The
--   planner does not hash it once — it re-evaluates the entire view per
--   output row. Measured on 192 editions:
--
--       the view alone            967 buffers,     8 ms
--       inside the function   297,553 buffers,   507 ms   (~300x)
--
--   This was latent from the day venue_temp_estimate shipped (2026-08-04,
--   water-temperature-for-event-venues) and got worse every three hours,
--   because the marine cron adds rows to spot_water_readings on a 3-hourly
--   schedule — 23,803 of them so far. It crossed the statement timeout
--   once the catalogue reached ~190 editions. It would have kept degrading
--   whether or not anyone touched this code again.
--
--   Fix: wrap the estimate in a MATERIALIZED CTE so Postgres evaluates it
--   exactly once and hash-joins the result. Nothing else about the
--   function changes — same signature, same columns, same filters, same
--   ordering, same 14-day rule for showing a temperature.
--
--       after:  25,487 buffers,  25 ms   (12x fewer buffers, 20x faster)
--
--   The remaining 24k buffers are the single unavoidable pass over
--   spot_water_readings inside spot_temp_estimate. That grows linearly
--   with the marine cron, but linearly ONCE rather than linearly times the
--   number of events, which is the difference that matters.

-- Requested by:
--   Dave — 2026-08-04, "looking at the /explore in chrome, it still wont
--   open, Could not load the swims. canceling statement due to statement
--   timeout".

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   -- Reproduce the problem. This is the exact call /explore makes:
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',200);
--   -- expect: ~297,000 buffers, ~500 ms, 192 rows
--
--   -- Confirm the view itself is cheap, i.e. the cost is the repetition:
--   EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM venue_temp_estimate;
--   -- expect: ~967 buffers, ~8 ms
--
--   -- The growing input behind it:
--   SELECT count(*) FROM spot_water_readings;   -- 23,803 and rising every 3h
--
--   -- Row count to compare against after the change:
--   SELECT count(*) FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',200);
--   -- expect 192

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- Not required: this replaces a STABLE function body. The previous
-- definition is preserved verbatim in the ROLLBACK section below (taken
-- from pg_get_functiondef before the change), and no data is touched.

BEGIN;

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
      -- A reading is today's water. It is a fair guide to next weekend and
      -- meaningless for a swim eleven months out, so it is shown only
      -- within 14 days. Unchanged from the original.
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
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$function$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — the exact prior definition, verbatim.
-- ----------------------------------------------------------------
-- Only the `LEFT JOIN venue_temp_estimate vte ON vte.venue_id = v.id` line
-- differs (it replaces the temps CTE and its join). Restoring it restores
-- the timeout, so roll back only if the new version is somehow wrong.
--
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.search_event_editions(...)  -- same signature
-- ... WITH base AS ( ... LEFT JOIN venue_temp_estimate vte ON vte.venue_id = v.id ... )
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- Same rows out — this is a performance change, not a behaviour change:
-- SELECT count(*) FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',200);
-- -- expect 192, unchanged from the pre-check
--
-- And it is actually faster:
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',200);
-- -- expect: ~25,000 buffers, ~25 ms  (was ~297,000 / ~500 ms)
--
-- Temperatures still appear on near-term events, and still ONLY there:
-- SELECT count(*) FILTER (WHERE water_temp_c IS NOT NULL) AS with_temp,
--        count(*) FILTER (WHERE start_date > current_date + 14 AND water_temp_c IS NOT NULL) AS leaked
--   FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',200);
-- -- expect: with_temp > 0, leaked = 0
--
-- The geo path still works:
-- SELECT count(*) FROM search_event_editions(-33.92,18.42,5000,CURRENT_DATE,NULL,false,NULL,NULL,'distance',200);
