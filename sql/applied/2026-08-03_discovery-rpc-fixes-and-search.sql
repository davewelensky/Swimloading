-- ================================================================
-- SwimLoading — Migration (RECORD OF APPLIED CHANGES)
-- ================================================================
--
-- ⚠️  HONEST NOTE ON THIS FILE
-- These three changes were applied to production on 2026-08-03 via
-- supabase-admin apply_migration, in response to bugs found while
-- testing, WITHOUT a migration file being written first. That breaks
-- the MIGRATIONS.md rule that every applied change has a file. This
-- file is written AFTER the fact to restore the record — it documents
-- exactly what was applied, in order, under the migration names shown.
--
-- Do NOT re-run this as a fresh migration expecting it to be new work;
-- it is already live. It is reproducible/idempotent if you do.
--
-- Applied migration names, in order:
--   1. resolve_dedupe_link_reciprocal_fix
--   2. approve_guard_rejected_and_past
--   3. event_search_and_prominence
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — ABORTED. Expected ref szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ────────────────────────────────────────────────────────────────
-- 1. resolve_dedupe_link_reciprocal_fix
-- ────────────────────────────────────────────────────────────────
-- BUG: the worker records duplicate findings in BOTH directions
-- (A->B and B->A). resolve_dedupe_link() resolved only the link it was
-- given, so retiring candidate A left candidate B still blocked by a
-- link pointing at the candidate just retired — an unclearable dead end
-- for the reviewer.
--
-- FIX: also resolve the reciprocal link. A duplicate decision is about
-- the PAIR, not one direction. It deliberately does NOT mark the other
-- candidate as a duplicate — the point of confirming a duplicate is that
-- one of the pair survives to be published.
--
-- Full function body: see sql/applied/2026-08-03_resolve-dedupe-link-rpc.sql,
-- which was updated in place to include this fix.

-- ────────────────────────────────────────────────────────────────
-- 2. approve_guard_rejected_and_past
-- ────────────────────────────────────────────────────────────────
-- BUG: publication_recommendation='rejected' was advisory only. A fast
-- review published a pool-only gala, a triathlon with no standalone swim,
-- and a 2019 results page listed as "announced" — all three reached the
-- public catalogue and had to be withdrawn.
--
-- FIX: two refusals added to approve_discovery_candidate(), each
-- overridable only by passing p_override_rejected explicitly:
--   GUARD 1 — refuses a candidate the classifier recommended rejecting
--   GUARD 2 — refuses a candidate whose start_date has already passed
-- Also added `OR auth.role() = 'service_role'` to the authorisation
-- check so the worker can call the same promotion path (decided_by stays
-- NULL, which is how the audit trail marks an automatic publish).
--
-- Signature changed: a 7th parameter p_override_rejected boolean was
-- added and the old 6-arg overload DROPped, so there is exactly one
-- version of this function.
--
-- Full function body: see sql/applied/2026-08-03_approve-discovery-candidate-rpc.sql,
-- which was updated in place.

-- ────────────────────────────────────────────────────────────────
-- 3. event_search_and_prominence
-- ────────────────────────────────────────────────────────────────
-- Public event search, plus the two ranking inputs it needs.
-- Reproduced in full here because no other file carries it.

ALTER TABLE public.event_editions
  ADD COLUMN IF NOT EXISTS participant_estimate integer
    CHECK (participant_estimate IS NULL OR participant_estimate >= 0);

ALTER TABLE public.event_series
  ADD COLUMN IF NOT EXISTS prominence text NOT NULL DEFAULT 'unknown'
    CHECK (prominence IN ('iconic','major','regional','local','unknown'));

COMMENT ON COLUMN public.event_series.prominence IS
  'Editorial significance, admin-set. iconic = a pilgrimage swim someone '
  'would fly for; local = a club meet. Drives destination-mode ranking, '
  'because headcount alone does not capture why an event matters.';

CREATE INDEX IF NOT EXISTS event_series_prominence_idx ON public.event_series (prominence);
CREATE INDEX IF NOT EXISTS event_editions_participants_idx
  ON public.event_editions (participant_estimate DESC NULLS LAST);

-- search_event_editions(): SECURITY INVOKER on purpose, so RLS enforces
-- visibility rather than the function deciding it. Reads organisers via
-- public_organisers so contact details stay out of reach. Haversine on
-- scalar lat/lng — PostGIS is not enabled in this project.
--
-- NOTE the radius rule: a radius search EXCLUDES events with no venue
-- coordinates. An earlier version let NULL-distance rows through, so
-- "within 150km of Manchester" returned events whose location was
-- unknown. Fixed before seeding any real data.
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
  participant_estimate integer, organiser_name text, distances jsonb, max_distance_m integer
)
LANGUAGE sql STABLE SET search_path = public
AS $fn$
  WITH base AS (
    SELECT e.id, e.title, s.display_name AS series_name, s.prominence,
      e.start_date, e.end_date, e.date_precision, e.date_confirmed,
      e.status, e.registration_status, e.registration_url, e.official_url,
      v.display_name AS venue_name, v.city, v.region, v.country_code,
      v.latitude, v.longitude, e.participant_estimate, o.display_name AS organiser_name,
      CASE WHEN p_lat IS NULL OR p_lng IS NULL OR v.latitude IS NULL THEN NULL
        ELSE round((6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat))*cos(radians(v.latitude))*cos(radians(v.longitude)-radians(p_lng))
            + sin(radians(p_lat))*sin(radians(v.latitude))))))::numeric, 1) END AS distance_km
    FROM event_editions e
    JOIN event_series s ON s.id = e.series_id
    LEFT JOIN event_venues v ON v.id = e.venue_id
    LEFT JOIN public_organisers o ON o.id = s.organiser_id
    WHERE e.status NOT IN ('cancelled','completed')
      AND (e.start_date IS NULL OR e.start_date >= COALESCE(p_date_from, current_date))
      AND (p_date_to IS NULL OR e.start_date IS NULL OR e.start_date <= p_date_to)
      AND (NOT p_weekend_only OR e.start_date IS NULL OR EXTRACT(DOW FROM e.start_date) IN (0,6))
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
    (SELECT max(d.distance_metres) FROM event_distances d WHERE d.edition_id=b.id)
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

-- ----------------------------------------------------------------
-- VERIFY (all confirmed passing on 2026-08-03)
-- ----------------------------------------------------------------
--   SELECT count(*) FROM pg_proc WHERE proname='search_event_editions';        -- 1
--   SELECT count(*) FROM pg_policies WHERE schemaname='public'
--     AND (tablename LIKE 'event\_%' OR tablename LIKE 'discovery\_%')
--     AND cmd<>'SELECT';                                                        -- 0
--   SELECT count(*) FROM event_editions WHERE start_date < current_date;        -- 0
