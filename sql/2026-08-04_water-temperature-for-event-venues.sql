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
-- Migration: 2026-08-04_water-temperature-for-event-venues.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Put a water temperature on every coastal EVENT, which is the one
--   thing SwimLoading has that no competitor and no search engine does.
--
--   The obvious route — link event_venues.spot_id to existing spots —
--   was measured first and does not work: only 5 of 162 venues have any
--   spot within 5km, and only 2 within 1km. The datasets barely overlap
--   because 175 of the 224 spots are South African while 131 of the 185
--   events are in the United States. Linking would deliver 5 rows.
--
--   The machinery is not the problem: spot_water_readings already holds
--   23,803 Open-Meteo readings across 100 spots, refreshed every 3h by
--   /api/cron/marine-temps.js, and spot_temp_estimate already blends
--   modelled and swimmer-reported temperatures with a confidence score.
--   It simply cannot address anything that is not a spot.
--
--   So: generalise the readings table to key on EITHER a spot or an
--   event venue. Same cron, same Open-Meteo call, same confidence
--   thinking — but now covering all 185 events worldwide rather than 5.
--
--   Why not just create spots for the venues instead? Because spots
--   drive the app's spot picker, temp logging and the Passport, and
--   docs/global-swim-discovery/database-schema.md is explicit that "a
--   race start line is not automatically a place anyone logs temps at".
--   Injecting 162 American race venues into every SA swimmer's spot
--   picker would be a real regression. Venues stay venues.

-- Requested by:
--   Dave — 2026-08-04, "lets do this: linking event_venues.spot_id to
--   real spots remains the highest-value unbuilt thing". The goal is
--   honoured; the route is changed because the data says the direct
--   link yields almost nothing. The 5 genuine spot matches ARE made
--   below — they are free and correct — they are just not the mechanism.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   SELECT count(*) FROM spot_water_readings;                    -- expect 23803ish
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name='spot_water_readings' AND column_name='venue_id';  -- expect 0
--   SELECT count(*) FROM event_venues WHERE spot_id IS NOT NULL; -- expect 0
--   -- Venues that will be linked to an existing spot (expect 2 at <=1km):
--   --   see the section-3 query; review the pairs before applying.

-- ----------------------------------------------------------------
-- BACKUP — the only UPDATE is setting spot_id on at most a handful of
-- venues, but the readings table is altered, so snapshot both shapes.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260804d_event_venues AS
  SELECT id, display_name, spot_id, latitude, longitude, now() AS backed_up_at
  FROM event_venues;

BEGIN;

-- ── 1. Readings can belong to a spot OR an event venue ────────────────
ALTER TABLE public.spot_water_readings
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.event_venues(id) ON DELETE CASCADE;

-- spot_id must become nullable for venue-keyed rows to exist at all.
ALTER TABLE public.spot_water_readings ALTER COLUMN spot_id DROP NOT NULL;

-- Exactly one owner per reading. Without this, a row could belong to both
-- or neither and every downstream aggregate would quietly double-count.
ALTER TABLE public.spot_water_readings
  DROP CONSTRAINT IF EXISTS spot_water_readings_one_owner;
ALTER TABLE public.spot_water_readings
  ADD CONSTRAINT spot_water_readings_one_owner
  CHECK ((spot_id IS NULL) <> (venue_id IS NULL));

-- The existing UNIQUE (spot_id, source, observed_at) does not constrain
-- venue rows at all, because NULL spot_id makes every venue row distinct
-- to it. Venue rows need their own idempotency key or the 3-hourly cron
-- would insert a duplicate on every pass.
CREATE UNIQUE INDEX IF NOT EXISTS spot_water_readings_venue_source_time
  ON public.spot_water_readings (venue_id, source, observed_at)
  WHERE venue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spot_water_readings_venue_source_time
  ON public.spot_water_readings (venue_id, source, observed_at DESC)
  WHERE venue_id IS NOT NULL;

COMMENT ON COLUMN public.spot_water_readings.venue_id IS
  'Set when this reading belongs to an event venue rather than a spot. '
  'Exactly one of spot_id / venue_id is non-null. Venues are kept out of '
  'the spots table on purpose — a race start line is not a place swimmers '
  'log temperatures at.';

-- ── 2. Latest modelled temperature per venue ──────────────────────────
-- Mirrors spot_water_latest so the two read the same way.
CREATE OR REPLACE VIEW public.venue_water_latest AS
  SELECT DISTINCT ON (r.venue_id, r.source)
         r.venue_id, r.source, r.sst_c, r.wave_height_m, r.observed_at, r.fetched_at
    FROM public.spot_water_readings r
   WHERE r.venue_id IS NOT NULL
   ORDER BY r.venue_id, r.source, r.observed_at DESC;

GRANT SELECT ON public.venue_water_latest TO anon, authenticated;

-- ── 3. Make the genuine spot links that DO exist ──────────────────────
-- Only where a venue sits within 1km of exactly one spot. Deliberately
-- strict: a wrong spot link would show a swimmer the wrong water
-- temperature, and planning for 18°C when it is 12°C is the kind of
-- error that gets someone into trouble. Everything looser stays unlinked
-- and simply uses its own modelled reading from section 1.
WITH near AS (
  SELECT v.id AS venue_id, s.id AS spot_id,
         6371 * acos(least(1, greatest(-1,
           cos(radians(v.latitude))*cos(radians(s.latitude))*cos(radians(s.longitude)-radians(v.longitude))
           + sin(radians(v.latitude))*sin(radians(s.latitude))))) AS km
    FROM event_venues v JOIN spots s
      ON v.latitude IS NOT NULL AND s.latitude IS NOT NULL
   WHERE v.spot_id IS NULL
),
best AS (
  SELECT venue_id, min(km) AS km, count(*) AS candidates
    FROM near WHERE km <= 1 GROUP BY venue_id
   HAVING count(*) = 1          -- ambiguous matches are left for a human
)
UPDATE event_venues v
   SET spot_id = n.spot_id
  FROM best b JOIN near n ON n.venue_id = b.venue_id AND n.km = b.km
 WHERE v.id = b.venue_id;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE event_venues v SET spot_id = b.spot_id
--   FROM _bak_20260804d_event_venues b WHERE b.id = v.id;
-- DROP VIEW IF EXISTS public.venue_water_latest;
-- DELETE FROM spot_water_readings WHERE venue_id IS NOT NULL;
-- DROP INDEX IF EXISTS spot_water_readings_venue_source_time;
-- DROP INDEX IF EXISTS idx_spot_water_readings_venue_source_time;
-- ALTER TABLE spot_water_readings DROP CONSTRAINT IF EXISTS spot_water_readings_one_owner;
-- ALTER TABLE spot_water_readings DROP COLUMN IF EXISTS venue_id;
-- ALTER TABLE spot_water_readings ALTER COLUMN spot_id SET NOT NULL;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_name='spot_water_readings' AND column_name='venue_id';   -- expect 1
-- SELECT count(*) FROM spot_water_readings WHERE spot_id IS NULL;        -- expect 0 (no venue rows yet)
-- SELECT count(*) FROM event_venues WHERE spot_id IS NOT NULL;           -- expect 2
--
-- Existing spot readings are untouched and the one-owner rule holds:
-- SELECT count(*) FROM spot_water_readings;                              -- expect unchanged
-- SELECT count(*) FROM spot_water_readings
--  WHERE (spot_id IS NULL) = (venue_id IS NULL);                         -- expect 0
--
-- After the cron is extended (api/cron/marine-temps.js), coastal venues
-- start reporting:
-- SELECT count(DISTINCT venue_id) FROM spot_water_readings WHERE venue_id IS NOT NULL;
