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
-- Migration: 2026-08-04_discipline-triathlon-swim-legs.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Give every candidate and edition a DISCIPLINE, so a triathlon's swim
--   leg can enter the catalogue without ever being mistaken for a
--   standalone open-water race.
--
--   Why now: the worker discarded 94 of 787 candidates — 12% of everything
--   crawled — as `triathlon_only`, because the only route to including one
--   was a `hasSeparateSwimEntry` flag read from an attribute that exists
--   solely in the test fixtures. On real pages it is always null, so the
--   include path was unreachable. ec9d104 replaces it with evidence: a
--   multisport page qualifies when it states a distance next to a swim
--   word, in 15 languages.
--
--   Why a separate axis rather than a new event_type: a triathlon's swim
--   leg IS a real official race. The event type is not what differs — the
--   discipline is. Keeping them apart is exactly what lets /explore show
--   open water only by default while a triathlete opts the legs in, so
--   neither audience sees a catalogue that is not for them.
--
--   Dave's decision, 2026-08-04: "open water only by default with a
--   toggle". The DEFAULT here is what enforces that on the data side; the
--   toggle is the client's half of the same promise.
--
--   The edition inherits its discipline from its candidate by trigger,
--   deliberately, rather than by editing approve_discovery_candidate —
--   that function is a large SECURITY DEFINER routine and rewriting it to
--   thread one column through is far more risk than a five-line trigger
--   on a column (source_candidate_id) that already exists.

-- Requested by:
--   Dave — 2026-08-04, "lets relook at the triathlon market and see how we
--   include triathlons, we know they spend money and the swim is generally
--   the biggest failure point for them", then "open water only by default
--   with a toggle".

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name IN ('discovery_candidate_events','event_editions')
--      AND column_name='discipline';                      -- expect 0
--
--   -- The editions that will be backfilled, and the ones that cannot be
--   -- (no source candidate — seeded by hand rather than crawled):
--   SELECT count(*) FILTER (WHERE source_candidate_id IS NOT NULL) AS linked,
--          count(*) FILTER (WHERE source_candidate_id IS NULL)     AS unlinked
--     FROM event_editions;
--
--   -- Nothing is multisport yet: the classifier change ships in the same
--   -- release but writes nothing until this migration lands.
--   SELECT count(*) FROM discovery_candidate_events;       -- note it; must not change

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- Both changes are additive columns with a safe default, so no row loses a
-- value. Backing up the edition keys anyway, since a trigger now writes to
-- them.
CREATE TABLE IF NOT EXISTS _bak_20260804g_editions AS
  SELECT id, source_candidate_id, title, now() AS backed_up_at FROM event_editions;

BEGIN;

-- ── 1. The column, on both sides of the approval boundary ─────────────
ALTER TABLE public.discovery_candidate_events
  ADD COLUMN IF NOT EXISTS discipline text NOT NULL DEFAULT 'open_water';
ALTER TABLE public.event_editions
  ADD COLUMN IF NOT EXISTS discipline text NOT NULL DEFAULT 'open_water';

ALTER TABLE public.discovery_candidate_events
  DROP CONSTRAINT IF EXISTS dce_discipline_check;
ALTER TABLE public.discovery_candidate_events
  ADD CONSTRAINT dce_discipline_check
  CHECK (discipline IN ('open_water', 'multisport_swim_leg'));

ALTER TABLE public.event_editions
  DROP CONSTRAINT IF EXISTS ee_discipline_check;
ALTER TABLE public.event_editions
  ADD CONSTRAINT ee_discipline_check
  CHECK (discipline IN ('open_water', 'multisport_swim_leg'));

COMMENT ON COLUMN public.event_editions.discipline IS
  '''open_water'' for a standalone swim; ''multisport_swim_leg'' for the swim '
  'leg of a triathlon or swimrun. /explore shows open water only unless the '
  'viewer opts the legs in — the default here is what makes that promise '
  'true even if a client forgets to filter.';

-- ── 2. The edition inherits it from its candidate ─────────────────────
-- A trigger rather than a change to approve_discovery_candidate: that
-- function is large, SECURITY DEFINER, and threading one column through it
-- is more risk than reading the column that already links the two.
CREATE OR REPLACE FUNCTION public.set_edition_discipline_from_candidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.source_candidate_id IS NOT NULL THEN
    SELECT c.discipline INTO NEW.discipline
      FROM discovery_candidate_events c
     WHERE c.id = NEW.source_candidate_id;
    -- A candidate that has vanished leaves the column at its default
    -- rather than null, so the NOT NULL holds and the safe value wins.
    IF NEW.discipline IS NULL THEN NEW.discipline := 'open_water'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_edition_discipline ON public.event_editions;
CREATE TRIGGER trg_edition_discipline
  BEFORE INSERT OR UPDATE OF source_candidate_id ON public.event_editions
  FOR EACH ROW EXECUTE FUNCTION public.set_edition_discipline_from_candidate();

-- ── 3. Backfill what is already published ─────────────────────────────
-- No-op today (nothing is multisport yet) but correct the moment the
-- worker starts writing the flag, and it makes the migration idempotent.
UPDATE event_editions e
   SET discipline = c.discipline
  FROM discovery_candidate_events c
 WHERE c.id = e.source_candidate_id
   AND e.discipline IS DISTINCT FROM c.discipline;

-- ── 4. Expose it to /explore ──────────────────────────────────────────
-- Returned rather than filtered server-side: the page loads every upcoming
-- swim once and filters client-side because the map's list follows the
-- viewport. Adding a p_discipline parameter would mean a round trip per
-- toggle for no benefit.
-- CREATE OR REPLACE cannot add a column to RETURNS TABLE — Postgres
-- refuses with "cannot change return type of existing function". The first
-- apply attempt failed on exactly this and rolled back cleanly, leaving
-- /explore untouched. The drop is safe only because this whole migration
-- is one transaction: there is never a moment where the function does not
-- exist for a caller.
DROP FUNCTION IF EXISTS public.search_event_editions(numeric,numeric,integer,date,date,boolean,integer,text,text,integer);

CREATE FUNCTION public.search_event_editions(
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
  water_temp_c numeric, water_confidence text, interested_count bigint,
  discipline text)
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
      e.verification_tier, e.confidence_score, e.discipline,
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
    b.water_temp_c, b.water_confidence, b.interested_count, b.discipline
  FROM base b
  WHERE p_radius_km IS NULL OR (b.distance_km IS NOT NULL AND b.distance_km <= p_radius_km)
  ORDER BY
    CASE WHEN p_sort='prominence' THEN array_position(ARRAY['iconic','major','regional','local','unknown'], b.prominence) END,
    CASE WHEN p_sort='prominence' THEN b.participant_estimate END DESC NULLS LAST,
    CASE WHEN p_sort='distance' THEN b.distance_km END NULLS LAST,
    b.start_date NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$function$;

-- DROP takes the grants with it. Captured before dropping:
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- /explore calls this as anon, so silently losing these would break the
-- page for logged-out visitors only — the worst kind of bug to ship.
GRANT EXECUTE ON FUNCTION public.search_event_editions(numeric,numeric,integer,date,date,boolean,integer,text,text,integer)
  TO anon, authenticated, service_role;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_edition_discipline ON public.event_editions;
-- DROP FUNCTION IF EXISTS public.set_edition_discipline_from_candidate();
-- ALTER TABLE public.event_editions            DROP COLUMN IF EXISTS discipline;
-- ALTER TABLE public.discovery_candidate_events DROP COLUMN IF EXISTS discipline;
-- -- search_event_editions must then be restored WITHOUT the discipline
-- -- column in its RETURNS TABLE — re-apply
-- -- 2026-08-04_raise-explore-result-ceiling.sql verbatim.
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- Columns exist and everything defaults to the safe value:
-- SELECT discipline, count(*) FROM event_editions GROUP BY 1;
-- -- expect: open_water = all of them, nothing else, today
--
-- The function still returns the same rows, now with the new column:
-- SELECT count(*), count(*) FILTER (WHERE discipline='open_water') AS ow
--   FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',1000);
-- -- expect both 208
--
-- Still fast (the ceiling fix must not have been lost):
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',1000);
-- -- expect ~30k buffers, well under 100 ms
--
-- The trigger actually inherits — run inside a transaction and ROLL BACK:
-- BEGIN;
--   UPDATE discovery_candidate_events SET discipline='multisport_swim_leg'
--    WHERE id = (SELECT source_candidate_id FROM event_editions
--                 WHERE source_candidate_id IS NOT NULL LIMIT 1);
--   UPDATE event_editions SET source_candidate_id = source_candidate_id
--    WHERE source_candidate_id IS NOT NULL LIMIT 1;   -- fires the trigger
--   SELECT discipline FROM event_editions WHERE source_candidate_id IS NOT NULL LIMIT 1;
--   -- expect multisport_swim_leg
-- ROLLBACK;
--
-- Grants survived the drop — verify BEFORE trusting the page:
-- SELECT proacl::text FROM pg_proc WHERE proname='search_event_editions';
-- -- expect anon=X, authenticated=X, service_role=X
--
-- Note on timing: the first call after a drop/recreate measured 198 ms
-- against 43 ms on the second, with IDENTICAL buffer counts (29,896). That
-- is plan-cache warm-up, not a regression — compare buffers, not just ms.
--
-- Junk is rejected:
-- BEGIN;
--   UPDATE event_editions SET discipline='cycling' WHERE id=(SELECT id FROM event_editions LIMIT 1);
--   -- expect: violates check constraint "ee_discipline_check"
-- ROLLBACK;
