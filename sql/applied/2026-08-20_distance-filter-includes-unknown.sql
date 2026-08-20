-- ================================================================
-- SwimLoading — Migration
-- ================================================================

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
-- Migration: 2026-08-20_distance-filter-includes-unknown.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Stop the Explore distance filter silently hiding every event whose
--   distances we have not parsed. It treated "we don't know" as "too short".

-- Requested by:
--   Dave — 20 Aug 2026, after reviewing which Explore searches returned
--   nothing. 17 of the 22 deliberate empty searches in the previous 30 days
--   had the distance filter on.

-- Context:
--   search_events_v2 and explore_country_facet both required
--       EXISTS (… d.distance_metres >= p_min_distance_m)
--   so an event with no parsed distance could never satisfy any minimum.
--   144 of 385 upcoming searchable events (37%) have no usable distance —
--   113 with no event_distances row at all, 31 whose rows exist but whose
--   metres were never parsed ("1½ km", "1.5K", "10K"). The moment a swimmer
--   touched the slider, 37% of the catalogue vanished with no indication it
--   had been filtered out.
--
--   An unknown distance is now included rather than excluded, and the card
--   labels it "Distance not listed" (explore.html). Ranking is unchanged:
--   the existing rank_score already awards 12 for a matched distance and 0
--   for an unmatched one, so these sort below genuine matches.
--
--   Both functions change together. If only the search changed, the country
--   facet counts would disagree with the list they label — the same class of
--   bug as the map pins showing swims the list said did not exist.

-- Not in scope:
--   Backfilling the 144 distances. "1½ km" is 1500 m, but a bare "1½" has no
--   unit and will not be guessed. Parser work is a separate change.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
-- Events newly visible when a distance filter is set.
--   expect: 144 of 385 upcoming searchable
-- SELECT count(*) FILTER (WHERE NOT EXISTS (
--          SELECT 1 FROM event_distances d
--           WHERE d.edition_id = e.id AND d.distance_metres IS NOT NULL)) AS unknown_distance,
--        count(*) AS upcoming_searchable
--   FROM event_editions e
--  WHERE e.is_searchable AND e.status NOT IN ('cancelled','completed')
--    AND COALESCE(e.end_date, e.start_date) >= current_date;

-- ----------------------------------------------------------------
-- BACKUP — the exact current definitions, so the rollback below is
-- the verbatim previous source rather than a retyped copy of it.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260820_explore_fns AS
  SELECT p.proname, pg_get_functiondef(p.oid) AS def, now() AS backed_up_at
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('search_events_v2', 'explore_country_facet');

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
--
-- Both bodies are reproduced from pg_get_functiondef unchanged except for
-- the p_min_distance_m predicate, which gains the third OR branch. The
-- VERIFY section below proves that mechanically rather than by eye.
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.explore_country_facet(
  p_lat numeric DEFAULT NULL::numeric,
  p_lng numeric DEFAULT NULL::numeric,
  p_radius_km integer DEFAULT NULL::integer,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_min_distance_m integer DEFAULT NULL::integer,
  p_water_type text DEFAULT NULL::text,
  p_weekend_only boolean DEFAULT false,
  p_entries_open boolean DEFAULT false,
  p_confirmed_only boolean DEFAULT false,
  p_featured boolean DEFAULT false,
  p_include_multisport boolean DEFAULT false)
 RETURNS TABLE(country_code text, n bigint, next_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      -- An event whose distances we have not parsed is UNKNOWN, not short.
      AND (p_min_distance_m IS NULL
           OR EXISTS (
                SELECT 1 FROM event_distances d
                 WHERE d.edition_id = e.id AND d.distance_metres >= p_min_distance_m)
           OR NOT EXISTS (
                SELECT 1 FROM event_distances d
                 WHERE d.edition_id = e.id AND d.distance_metres IS NOT NULL))
  ),
  filtered AS (
    SELECT * FROM base b
     WHERE p_radius_km IS NULL
        OR (b.distance_km IS NOT NULL AND b.distance_km <= p_radius_km)
  )
  SELECT f.country_code, count(*) AS n, min(f.start_date) AS next_date
    FROM filtered f
   WHERE f.country_code IS NOT NULL
   GROUP BY f.country_code
   ORDER BY count(*) DESC, f.country_code;
$function$;

CREATE OR REPLACE FUNCTION public.search_events_v2(
  p_lat numeric DEFAULT NULL::numeric,
  p_lng numeric DEFAULT NULL::numeric,
  p_radius_km integer DEFAULT NULL::integer,
  p_country text DEFAULT NULL::text,
  p_region text DEFAULT NULL::text,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_min_distance_m integer DEFAULT NULL::integer,
  p_water_type text DEFAULT NULL::text,
  p_weekend_only boolean DEFAULT false,
  p_entries_open boolean DEFAULT false,
  p_confirmed_only boolean DEFAULT false,
  p_featured boolean DEFAULT false,
  p_include_multisport boolean DEFAULT false,
  p_sort text DEFAULT 'relevance'::text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20)
 RETURNS TABLE(edition_id uuid, slug text, title text, series_name text, prominence text, start_date date, end_date date, date_precision text, date_confirmed boolean, status text, registration_status text, registration_url text, official_url text, venue_name text, city text, region text, country_code text, water_body_type text, latitude numeric, longitude numeric, distance_km numeric, participant_estimate integer, organiser_name text, distances jsonb, max_distance_m integer, matched_distance_m integer, verification_tier text, confidence_score smallint, last_verified_at timestamp with time zone, officially_claimed boolean, water_temp_c numeric, water_confidence text, interested_count bigint, discipline text, is_featured boolean, is_weekend boolean, entries_open boolean, rank_score integer, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      CASE WHEN e.start_date <= current_date + 14 THEN round(vte.best_c, 1) END AS water_temp_c,
      CASE WHEN e.start_date <= current_date + 14 THEN vte.confidence END      AS water_confidence,
      COALESCE(ic.interested, 0) AS interested_count,
      (EXTRACT(DOW FROM e.start_date) IN (0,6))            AS is_weekend,
      (e.registration_status = 'open')                     AS entries_open,
      (SELECT max(d.distance_metres) FROM event_distances d WHERE d.edition_id = e.id) AS max_distance_m,
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
      AND COALESCE(e.end_date, e.start_date) >= GREATEST(COALESCE(p_date_from, current_date), current_date)
      AND (p_date_to        IS NULL OR e.start_date <= p_date_to)
      AND (p_country        IS NULL OR v.country_code = upper(p_country))
      AND (p_region         IS NULL OR v.region = p_region)
      AND (p_water_type     IS NULL OR v.water_body_type = p_water_type)
      AND (NOT p_weekend_only   OR EXTRACT(DOW FROM e.start_date) IN (0,6))
      AND (NOT p_entries_open   OR e.registration_status = 'open')
      AND (NOT p_confirmed_only OR e.date_confirmed)
      AND (NOT p_featured       OR e.is_featured)
      AND (p_include_multisport OR COALESCE(e.discipline,'open_water') <> 'multisport_swim_leg')
      -- An event whose distances we have not parsed is UNKNOWN, not short.
      -- matched_distance_m above stays NULL for these, so rank_score already
      -- scores them 0 rather than 12 and they sort below genuine matches.
      AND (p_min_distance_m IS NULL
           OR EXISTS (
                SELECT 1 FROM event_distances d
                 WHERE d.edition_id = e.id AND d.distance_metres >= p_min_distance_m)
           OR NOT EXISTS (
                SELECT 1 FROM event_distances d
                 WHERE d.edition_id = e.id AND d.distance_metres IS NOT NULL))
  ),
  filtered AS (
    SELECT * FROM base b
     WHERE p_radius_km IS NULL
        OR (b.distance_km IS NOT NULL AND b.distance_km <= p_radius_km)
  ),
  scored AS (
    SELECT f.*,
      (
        CASE
          WHEN f.distance_km IS NULL THEN 0
          WHEN f.distance_km <=  25 THEN 30
          WHEN f.distance_km <=  50 THEN 26
          WHEN f.distance_km <= 100 THEN 21
          WHEN f.distance_km <= 200 THEN 15
          WHEN f.distance_km <= 400 THEN 8
          ELSE 3
        END
        + CASE
            WHEN f.start_date <= current_date + 14  THEN 14
            WHEN f.start_date <= current_date + 56  THEN 20
            WHEN f.start_date <= current_date + 120 THEN 16
            WHEN f.start_date <= current_date + 240 THEN 10
            ELSE 5
          END
        + CASE
            WHEN p_min_distance_m IS NULL THEN 6
            WHEN f.matched_distance_m IS NOT NULL THEN 12
            ELSE 0
          END
        + CASE f.verification_tier
            WHEN 'confirmed'  THEN 18
            WHEN 'listed'     THEN 11
            WHEN 'unverified' THEN 3
            ELSE 0
          END
        + CASE WHEN f.officially_claimed THEN 6 ELSE 0 END
        + CASE f.registration_status
            WHEN 'open'     THEN 8
            WHEN 'sold_out' THEN 2
            WHEN 'closed'   THEN 0
            ELSE 4
          END
        + CASE f.prominence
            WHEN 'iconic'   THEN 10
            WHEN 'major'    THEN 7
            WHEN 'regional' THEN 4
            WHEN 'local'    THEN 2
            ELSE 0
          END
        + CASE WHEN f.is_featured THEN 6 ELSE 0 END
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
    count(*) OVER () AS total_count
  FROM scored sc
  ORDER BY
    CASE WHEN p_sort = 'date'       THEN sc.start_date END ASC  NULLS LAST,
    CASE WHEN p_sort = 'distance'   THEN sc.distance_km END ASC NULLS LAST,
    CASE WHEN p_sort = 'relevance'  THEN sc.rank_score END DESC NULLS LAST,
    CASE WHEN p_sort = 'prominence'
         THEN array_position(ARRAY['iconic','major','regional','local','unknown'], sc.prominence) END ASC,
    sc.start_date ASC NULLS LAST, sc.id ASC
  LIMIT  LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 60)
  OFFSET LEAST(GREATEST(COALESCE(p_page, 1), 1) - 1, 500)
         * LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 60);
$function$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — replay the verbatim previous source:
--
--   SELECT def FROM _bak_20260820_explore_fns WHERE proname = 'search_events_v2';
--   SELECT def FROM _bak_20260820_explore_fns WHERE proname = 'explore_country_facet';
--
-- and execute each. No data is touched by this migration, so nothing else
-- needs undoing.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
-- 1. Prove the ONLY change is the intended predicate: strip whitespace and
--    the added branch from the new definition and compare to the backup.
--    expect: both rows identical = true
-- SELECT b.proname,
--        regexp_replace(
--          regexp_replace(pg_get_functiondef(p.oid),
--            '\s*--[^\n]*', '', 'g'),
--          '\s+', ' ', 'g')
--        = regexp_replace(
--          regexp_replace(b.def, '\s*--[^\n]*', '', 'g'),
--          '\s+', ' ', 'g') AS unchanged_apart_from_predicate
--   FROM _bak_20260820_explore_fns b
--   JOIN pg_proc p ON p.proname = b.proname
--   JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public';
--   -- (expect FALSE for both — the predicate DID change. Read the diff.)
--
-- 2. A 1 km minimum now returns the unknown-distance events too.
--    expect: after > before, by roughly the 144 unknown-distance events
-- SELECT count(*) FROM search_events_v2(p_min_distance_m => 1000, p_page_size => 60);
--
-- 3. The facet total and the list total agree for the same filter.
--    expect: equal
-- SELECT (SELECT sum(n) FROM explore_country_facet(p_min_distance_m => 1000)) AS facet_total,
--        (SELECT max(total_count) FROM search_events_v2(p_min_distance_m => 1000, p_page_size => 1)) AS list_total;
