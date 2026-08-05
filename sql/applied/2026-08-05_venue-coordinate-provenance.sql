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
-- Migration: 2026-08-05_venue-coordinate-provenance.sql
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: 160 'extracted', 7 'spot',
--            75 NULL (all of which genuinely have no coordinates), and zero
--            coordinates changed by this migration.
-- ================================================================

-- Purpose:
--   Record WHERE a venue's coordinates came from, before geocoding starts
--   writing new ones.
--
--   75 of 242 venues have no coordinates. That is not cosmetic: the search
--   RPC filters `distance_km IS NOT NULL AND distance_km <= radius`, so a
--   venue without coordinates DISAPPEARS from any radius search — and the
--   map viewport drives a radius search on every pan. 13 of Australia's 15
--   events and all 5 Polish events are in that state, which is why they are
--   invisible on /explore unless you happen not to touch the map.
--
--   Geocoding fixes that, but a geocoded point is a weaker fact than one
--   copied from a SwimLoading spot or given by an organiser. "Coogee NSW"
--   resolves to the suburb centroid, not the beach the swim starts from.
--   That is fine for a map pin and wrong for a start line, and the
--   difference has to be recordable or someone will later treat all
--   coordinates as equal.
--
--   So: provenance first, geocoding second.

-- Requested by:
--   Dave — 2026-08-05, "so I dont see 15 in Aus or 5 in poland ?" — they
--   were listed but had no coordinates.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- 1. Columns must not exist (expect 0):
--      SELECT count(*) FROM information_schema.columns
--       WHERE table_name='event_venues'
--         AND column_name IN ('coordinates_source','geocoded_at','geocode_matched_name');
--
-- 2. The shape of the backfill (ACTUAL 2026-08-05):
--      SELECT count(*) FILTER (WHERE spot_id IS NOT NULL AND latitude IS NOT NULL) AS from_spot,
--             count(*) FILTER (WHERE spot_id IS NULL AND latitude IS NOT NULL)     AS from_crawler,
--             count(*) FILTER (WHERE latitude IS NULL)                             AS none
--        FROM event_venues;
--      -- expect roughly 8 / 159 / 75

-- ----------------------------------------------------------------
-- BACKUP — required: UPDATEs every venue row to set provenance.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260805f_event_venues AS
  SELECT id, display_name, latitude, longitude, spot_id, now() AS backed_up_at
  FROM event_venues;

BEGIN;

ALTER TABLE public.event_venues
  ADD COLUMN IF NOT EXISTS coordinates_source   text
    CHECK (coordinates_source IS NULL OR coordinates_source IN
           ('spot','organiser','geocoded','extracted','manual')),
  ADD COLUMN IF NOT EXISTS geocoded_at          timestamptz,
  -- Exactly what the geocoder matched, kept verbatim. When a pin turns out
  -- to be on the wrong beach this is the only way to see whether the
  -- geocoder was wrong or the location text was.
  ADD COLUMN IF NOT EXISTS geocode_matched_name text;

COMMENT ON COLUMN public.event_venues.coordinates_source IS
  'Where latitude/longitude came from, weakest to strongest: '
  '''geocoded'' (a place-name lookup — a town centroid, good enough for a '
  'map pin and NOT a start line), ''extracted'' (read off the source page '
  'by the crawler), ''spot'' (copied from a SwimLoading spot), '
  '''organiser'' or ''manual'' (given by a person). Never treat these as '
  'equally precise.';

-- Backfill what we can infer. A venue bound to a spot took its coordinates
-- from that spot — see sql/applied/2026-08-05_bigbay-organiser-calendar.sql,
-- which copies them rather than typing them. Everything else with
-- coordinates came off a source page via the crawler.
UPDATE public.event_venues
   SET coordinates_source = CASE
         WHEN latitude IS NULL   THEN NULL
         WHEN spot_id IS NOT NULL THEN 'spot'
         ELSE 'extracted'
       END
 WHERE coordinates_source IS NULL;

CREATE INDEX IF NOT EXISTS event_venues_needs_geocode_idx
  ON public.event_venues (country_code) WHERE latitude IS NULL;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP INDEX IF EXISTS event_venues_needs_geocode_idx;
-- ALTER TABLE public.event_venues
--   DROP COLUMN IF EXISTS coordinates_source,
--   DROP COLUMN IF EXISTS geocoded_at,
--   DROP COLUMN IF EXISTS geocode_matched_name;
-- COMMIT;
-- No coordinate is changed by this migration, so nothing to restore beyond
-- dropping the columns.

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- 1. Every venue WITH coordinates has a source, and every venue without has none:
--      SELECT coordinates_source, count(*), count(*) FILTER (WHERE latitude IS NULL) AS no_coords
--        FROM event_venues GROUP BY 1 ORDER BY 2 DESC;
--      -- expect: 'extracted' ~159, 'spot' ~8, NULL ~75 (all of which have no coords)
--
-- 2. No coordinate was touched — compare against the backup:
--      SELECT count(*) FROM event_venues v JOIN _bak_20260805f_event_venues b ON b.id=v.id
--       WHERE v.latitude IS DISTINCT FROM b.latitude
--          OR v.longitude IS DISTINCT FROM b.longitude;      -- expect 0
--
-- 3. The geocoding queue is what we think it is:
--      SELECT country_code, count(*) FROM event_venues
--       WHERE latitude IS NULL GROUP BY 1 ORDER BY 2 DESC;
