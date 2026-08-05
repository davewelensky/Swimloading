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
--   Put a water temperature on coastal EVENTS — the one thing
--   SwimLoading has that no competitor and no search engine does.
--
--   Two findings shaped this, both measured rather than assumed:
--
--   1. The obvious route, linking event_venues.spot_id to existing
--      spots, does not work at scale: only 5 of 162 venues have any
--      spot within 5km and 2 within 1km, because 175 of the 224 spots
--      are South African while 131 of the 185 events are American. The
--      2 genuine sub-1km links ARE made below — free and correct — but
--      they are not the mechanism.
--
--   2. Venue readings must NOT share the app's spot_water_readings
--      table. Dave, 2026-08-04: "we dont add any data to swimloading
--      app, these 652 users are real." The app's spot_water_latest view
--      is `SELECT DISTINCT ON (spot_id, source) ... FROM
--      spot_water_readings` with NO filter on spot_id, so venue rows
--      carrying a null spot_id would immediately surface a null-spot row
--      in a view 652 real users depend on. It would not corrupt any
--      individual spot's temperature (the join never matches null), but
--      relying on that is relying on an accident.
--
--   So event water temperature gets its own table, its own latest-view
--   and its own estimate view, mirroring the spot ones exactly. Nothing
--   in the app's read path is touched. This also matches the standing
--   architectural rule in docs/global-swim-discovery/database-schema.md:
--   two separate groups of tables, do not merge them.
--
--   Coverage caveat, stated up front: Open-Meteo Marine models oceans
--   and seas only. Lake and river events — a good share of Ray's
--   Notebook — will have no modelled temperature, exactly as the 69
--   pools and 16 inland spots do today. Those show nothing rather than
--   a guess.

-- Requested by:
--   Dave — 2026-08-04, "lets do this: linking event_venues.spot_id to
--   real spots remains the highest-value unbuilt thing", then "we dont
--   add any data to swimloading app... we can still mess with the
--   /explore app as its being developed so proceed".

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name='venue_water_readings';                    -- expect 0
--   SELECT count(*) FROM event_venues WHERE spot_id IS NOT NULL; -- expect 0
--   SELECT count(*) FROM spot_water_readings;                    -- note it; must not change
--
-- Venues that will be linked to a spot — review the pairs first:
--   WITH near AS (SELECT v.display_name AS venue, s.name AS spot,
--     6371*acos(least(1,greatest(-1,cos(radians(v.latitude))*cos(radians(s.latitude))
--     *cos(radians(s.longitude)-radians(v.longitude))+sin(radians(v.latitude))
--     *sin(radians(s.latitude))))) AS km
--     FROM event_venues v JOIN spots s ON true
--     WHERE v.latitude IS NOT NULL AND s.latitude IS NOT NULL AND v.spot_id IS NULL)
--   SELECT * FROM near WHERE km <= 1 ORDER BY km;                -- expect 2

-- ----------------------------------------------------------------
-- BACKUP — the only UPDATE is spot_id on at most a couple of venues.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260804d_event_venues AS
  SELECT id, display_name, spot_id, latitude, longitude, now() AS backed_up_at
  FROM event_venues;

BEGIN;

-- ── 1. Event water readings, entirely separate from the app's ─────────
CREATE TABLE IF NOT EXISTS public.venue_water_readings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid NOT NULL REFERENCES public.event_venues(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('open_meteo','copernicus')),
  sst_c         numeric(4,1),
  wave_height_m numeric(4,2),
  observed_at   timestamptz NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  raw           jsonb,
  -- Idempotency: the cron runs every 3h and must update in place rather
  -- than accumulate a duplicate per pass.
  CONSTRAINT venue_water_readings_uniq UNIQUE (venue_id, source, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_venue_water_readings_venue_source_time
  ON public.venue_water_readings (venue_id, source, observed_at DESC);

COMMENT ON TABLE public.venue_water_readings IS
  'Modelled water temperature for EVENT venues. Deliberately separate from '
  'spot_water_readings: that table feeds spot_water_latest and '
  'spot_temp_estimate, which the live app shows to real users, and it has '
  'no spot_id filter — mixing venue rows in would surface a null-spot row '
  'in the app. Two catalogues, two tables.';

ALTER TABLE public.venue_water_readings ENABLE ROW LEVEL SECURITY;

-- Public read: a swimmer looking at a listing should see the temperature
-- without signing in. Writes are worker-only (service role bypasses RLS);
-- no client role gets INSERT/UPDATE/DELETE, matching every other
-- discovery table.
DROP POLICY IF EXISTS vwr_public_read ON public.venue_water_readings;
CREATE POLICY vwr_public_read ON public.venue_water_readings
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.venue_water_readings TO anon, authenticated;

-- ── 2. Latest reading per venue ───────────────────────────────────────
CREATE OR REPLACE VIEW public.venue_water_latest AS
  SELECT DISTINCT ON (venue_id, source)
         venue_id, source, sst_c, wave_height_m, observed_at, fetched_at
    FROM public.venue_water_readings
   ORDER BY venue_id, source, observed_at DESC;

GRANT SELECT ON public.venue_water_latest TO anon, authenticated;

-- ── 3. Estimate + confidence, mirroring spot_temp_estimate ────────────
-- Same confidence vocabulary as the spot version so the two read
-- identically in the UI. A venue that is ALSO linked to a spot prefers
-- the spot's blended estimate, because that one can include real swimmer
-- readings; otherwise it uses its own modelled value.
CREATE OR REPLACE VIEW public.venue_temp_estimate AS
  SELECT v.id AS venue_id,
         v.spot_id,
         COALESCE(ste.best_c, m.sst_c)                        AS best_c,
         CASE WHEN ste.best_c IS NOT NULL THEN ste.best_source
              WHEN m.sst_c   IS NOT NULL THEN 'model'
              ELSE NULL END                                    AS best_source,
         CASE
           WHEN ste.best_c IS NOT NULL THEN ste.confidence
           -- A model reading is only "medium" while it is fresh; the cron
           -- runs 3-hourly, so 12h stale means something has gone wrong.
           WHEN m.sst_c IS NOT NULL AND m.observed_at >= now() - interval '12 hours' THEN 'medium'
           WHEN m.sst_c IS NOT NULL THEN 'low'
           ELSE 'none'
         END                                                   AS confidence,
         m.observed_at                                         AS model_at
    FROM public.event_venues v
    LEFT JOIN public.venue_water_latest m
           ON m.venue_id = v.id AND m.source = 'open_meteo'
    LEFT JOIN public.spot_temp_estimate ste
           ON ste.spot_id = v.spot_id;

GRANT SELECT ON public.venue_temp_estimate TO anon, authenticated;

COMMENT ON VIEW public.venue_temp_estimate IS
  'Best available water temperature per event venue, with the same '
  'confidence vocabulary as spot_temp_estimate. Prefers a linked spot''s '
  'blended estimate (which can include swimmer readings) over the venue''s '
  'own modelled value. NULL best_c means we do not know — never a guess.';

-- ── 4. The genuine spot links that DO exist ───────────────────────────
-- Only where a venue sits within 1km of exactly one spot. Deliberately
-- strict: a wrong link shows a swimmer the wrong water temperature, and
-- planning for 18°C when it is 12°C is how someone gets into trouble.
-- Anything looser stays unlinked and uses its own modelled reading.
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
  SELECT venue_id, min(km) AS km
    FROM near WHERE km <= 1
   GROUP BY venue_id
  HAVING count(*) = 1              -- ambiguous matches left for a human
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
-- DROP VIEW IF EXISTS public.venue_temp_estimate;
-- DROP VIEW IF EXISTS public.venue_water_latest;
-- DROP TABLE IF EXISTS public.venue_water_readings;
-- COMMIT;
-- Nothing in the app's own tables is touched by this migration, so there
-- is nothing to restore there.

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- The app is provably untouched — this is the point of the migration:
-- SELECT count(*) FROM spot_water_readings;                  -- expect UNCHANGED
-- SELECT count(*) FROM spot_water_latest WHERE spot_id IS NULL;  -- expect 0
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_name='spot_water_readings' AND column_name='venue_id';  -- expect 0
--
-- New objects exist and are readable by anon:
-- SELECT count(*) FROM information_schema.tables WHERE table_name='venue_water_readings'; -- 1
-- SELECT count(*) FROM venue_temp_estimate;                  -- expect 162 (one per venue)
-- SELECT count(*) FROM venue_temp_estimate WHERE best_c IS NOT NULL;  -- expect 2 (the spot-linked ones)
-- SELECT count(*) FROM event_venues WHERE spot_id IS NOT NULL;        -- expect 2
--
-- After the cron is extended, coastal venues start reporting:
-- SELECT confidence, count(*) FROM venue_temp_estimate GROUP BY 1;
