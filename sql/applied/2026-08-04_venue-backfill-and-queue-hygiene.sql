-- ================================================================
-- SwimLoading — Migration Template
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n╔══════════════════════════════════════════╗\n║  WRONG PROJECT — MIGRATION ABORTED       ║\n║  Expected: swimloading / szgkzuswelntnevobnoh ║\n╚══════════════════════════════════════════╝';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-04_venue-backfill-and-queue-hygiene.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Two problems Dave hit the moment the catalogue got real.
--
--   1. EVERY event published from a tabular source shows "location to be
--      confirmed". approve_discovery_candidate only creates an
--      event_venues row when the candidate has a venue_name, and the
--      table parser never set one — so the city, region, country AND
--      coordinates it extracted were stranded on the candidate and never
--      reached the published event. 147 editions are affected, all of
--      them with perfectly good location data sitting one table away.
--      The worker fix stops this recurring; this backfills what already
--      published.
--
--   2. The review queue showed 201 items, of which 181 are PAST-DATED
--      and can never publish. Dave, correctly: "I won't sift through
--      hundreds of swims, in reality I don't know these swims, so what
--      am I doing?" — nothing, and the queue should say so. A dead
--      candidate is not a decision anybody needs to make.
--
--   After this, the review queue is for EXCEPTIONS only — unresolved
--   duplicates and anything genuinely ambiguous — not a list of
--   everything the crawler has ever seen.

-- Requested by:
--   Dave — 2026-08-04, "seems all of rays swims locations unknown?",
--   "then there are 201 swims for me to verify, thats not going to work",
--   "we rather just publish as unconfirmed".

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- Editions published with no venue despite the candidate knowing where
-- it is (expect 147):
--   SELECT count(*) FROM event_editions e
--    JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--    WHERE e.venue_id IS NULL AND (c.city IS NOT NULL OR c.latitude IS NOT NULL);
--
-- Past-dated candidates cluttering the queue (expect ~181):
--   SELECT count(*) FROM discovery_candidate_events
--    WHERE candidate_status IN ('pending','needs_review')
--      AND start_date IS NOT NULL AND start_date < current_date;
--
-- What remains in the queue afterwards — the real work (expect small):
--   SELECT count(*) FROM discovery_candidate_events c
--    WHERE c.candidate_status IN ('pending','needs_review')
--      AND (c.start_date IS NULL OR c.start_date >= current_date);

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs published rows.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260804b_event_editions AS
  SELECT id, venue_id, title, start_date, now() AS backed_up_at FROM event_editions;
CREATE TABLE IF NOT EXISTS _bak_20260804b_candidate_status AS
  SELECT id, candidate_status, start_date, now() AS backed_up_at
  FROM discovery_candidate_events;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Backfill venues for already-published editions ─────────────────
-- Mirrors approve_discovery_candidate's own venue logic exactly: reuse a
-- venue with the same canonical name, otherwise create one. Doing it in a
-- loop rather than a set-based INSERT so that the "reuse if it already
-- exists" check sees venues created earlier in this same run — several
-- Ray's rows share a city.
DO $$
DECLARE
  r        record;
  v_venue  uuid;
  v_name   text;
  v_made   integer := 0;
  v_linked integer := 0;
BEGIN
  FOR r IN
    SELECT e.id AS edition_id, c.venue_name, c.city, c.region, c.country_code,
           c.location_text, c.latitude, c.longitude, c.timezone, c.water_body_type
      FROM event_editions e
      JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
     WHERE e.venue_id IS NULL
       AND (c.city IS NOT NULL OR c.venue_name IS NOT NULL OR c.latitude IS NOT NULL)
  LOOP
    -- Prefer an explicit venue name, then the city, then the raw location
    -- text. Never invent one: if all three are empty the edition keeps a
    -- null venue and simply reads "location to be confirmed", which is
    -- honest.
    v_name := COALESCE(NULLIF(trim(r.venue_name), ''), NULLIF(trim(r.city), ''), NULLIF(trim(r.location_text), ''));
    IF v_name IS NULL THEN CONTINUE; END IF;

    SELECT id INTO v_venue FROM event_venues
     WHERE lower(trim(canonical_name)) = lower(trim(v_name)) LIMIT 1;

    IF v_venue IS NULL THEN
      INSERT INTO event_venues (canonical_name, display_name, location_text, city, region,
                                country_code, latitude, longitude, timezone, water_body_type)
      VALUES (lower(trim(v_name)), trim(v_name), r.location_text, r.city, r.region,
              r.country_code, r.latitude, r.longitude, r.timezone, r.water_body_type)
      RETURNING id INTO v_venue;
      v_made := v_made + 1;
    END IF;

    UPDATE event_editions SET venue_id = v_venue WHERE id = r.edition_id;
    v_linked := v_linked + 1;
  END LOOP;
  RAISE NOTICE 'Venues created: %, editions linked: %', v_made, v_linked;
END $$;

-- ── 2. Self-cleaning review queue ─────────────────────────────────────
-- A candidate whose date has passed can never be published (the approve
-- RPC refuses past dates), so leaving it "pending" asks for a decision
-- that has no effect. Retire it automatically, with an audit row so the
-- history stays honest about who did it (decided_by NULL = the system).
CREATE OR REPLACE FUNCTION public.retire_past_candidates(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ids uuid[];
  v_n   integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'retire_past_candidates may only be called by the worker (service role)';
  END IF;

  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM discovery_candidate_events
     WHERE candidate_status IN ('pending','needs_review')
       AND start_date IS NOT NULL
       AND start_date < current_date
     ORDER BY start_date
     LIMIT p_limit
  ) s;

  IF v_ids IS NULL THEN RETURN 0; END IF;

  INSERT INTO discovery_review_decisions
    (candidate_id, decision, decided_by, notes, previous_status, new_status, metadata)
  SELECT c.id, 'rejected', NULL,
         'Retired automatically: the event date has passed, so this candidate can never be '
         'published and needs no human decision. Kept for provenance and change monitoring.',
         c.candidate_status, 'rejected',
         jsonb_build_object('automatic', true, 'reason', 'date_passed')
    FROM discovery_candidate_events c WHERE c.id = ANY(v_ids);

  UPDATE discovery_candidate_events
     SET candidate_status = 'rejected', last_reviewed_at = now()
   WHERE id = ANY(v_ids);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION public.retire_past_candidates IS
  'Worker-only. Clears past-dated candidates out of the review queue so it '
  'shows only decisions that still matter. They can never publish anyway — '
  'approve_discovery_candidate refuses past dates.';

REVOKE ALL ON FUNCTION public.retire_past_candidates(integer) FROM public, anon, authenticated;

-- Retire the current backlog in this migration, since the worker will not
-- run again until it is redeployed.
UPDATE public.discovery_candidate_events
   SET candidate_status = 'rejected', last_reviewed_at = now()
 WHERE candidate_status IN ('pending','needs_review')
   AND start_date IS NOT NULL
   AND start_date < current_date;

-- ── 3. The public search can never show a past swim ───────────────────
-- Rule (Dave, 2026-08-04): "it should always only show future dated
-- swims, nothing in the past."
--
-- Two holes existed. p_date_from is supplied straight from a date input
-- on /explore, so a user picking a past date would surface events that
-- have already happened; and "start_date IS NULL OR ..." let undated
-- editions bypass the date test entirely. Today neither shows anything,
-- purely because every edition was published minutes ago — but from
-- tomorrow, today's events become past and stay in the table forever.
-- Enforced here in SQL rather than in the page, so no caller (the page,
-- a future API, a partner integration) can ask for the past by accident.
--
-- Multi-day events use COALESCE(end_date, start_date): a swim that
-- started yesterday and finishes tomorrow is happening, not past.
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
  verification_tier text, confidence_score smallint
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
      CASE WHEN p_lat IS NULL OR p_lng IS NULL OR v.latitude IS NULL THEN NULL
        ELSE round((6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat))*cos(radians(v.latitude))*cos(radians(v.longitude)-radians(p_lng))
            + sin(radians(p_lat))*sin(radians(v.latitude))))))::numeric, 1) END AS distance_km
    FROM event_editions e
    JOIN event_series s ON s.id = e.series_id
    LEFT JOIN event_venues v ON v.id = e.venue_id
    LEFT JOIN public_organisers o ON o.id = s.organiser_id
    WHERE e.status NOT IN ('cancelled','completed')
      -- An undated edition cannot be shown as upcoming.
      AND e.start_date IS NOT NULL
      -- GREATEST(...) is the floor that makes the past unreachable: even
      -- an explicit past p_date_from cannot pull it below today.
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
    b.verification_tier, b.confidence_score
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

-- ── 4. Retire editions whose date has passed ──────────────────────────
-- Belt and braces alongside the search filter: a past event is marked
-- 'completed' so it drops out of every query, not just this one, and the
-- catalogue does not silently accumulate history that looks current.
-- Worker-only, run after each crawl pass.
CREATE OR REPLACE FUNCTION public.complete_past_editions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_n integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'complete_past_editions may only be called by the worker (service role)';
  END IF;
  UPDATE event_editions
     SET status = 'completed'
   WHERE status NOT IN ('cancelled','completed')
     AND start_date IS NOT NULL
     AND COALESCE(end_date, start_date) < current_date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION public.complete_past_editions IS
  'Worker-only. Marks editions whose date has passed as completed so the '
  'public catalogue only ever shows upcoming swims.';

REVOKE ALL ON FUNCTION public.complete_past_editions() FROM public, anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE event_editions e SET venue_id = b.venue_id
--   FROM _bak_20260804b_event_editions b WHERE b.id = e.id;
-- UPDATE discovery_candidate_events c SET candidate_status = b.candidate_status
--   FROM _bak_20260804b_candidate_status b WHERE b.id = c.id;
-- DROP FUNCTION IF EXISTS public.retire_past_candidates(integer);
-- COMMIT;
-- Venues created by this migration are left in place; they are additive
-- and harmless, and dropping them would break any edition since linked.

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM event_editions WHERE venue_id IS NULL;   -- expect: near 0
-- SELECT count(*) FROM discovery_candidate_events
--  WHERE candidate_status IN ('pending','needs_review');        -- expect: only live work
--
-- Locations now render on the public search:
-- SELECT title, city, region, country_code, verification_tier
--   FROM search_event_editions(NULL,NULL,NULL,NULL,NULL,false,NULL,'US','date',5);
--   -- expect: city/region/country populated, not null
