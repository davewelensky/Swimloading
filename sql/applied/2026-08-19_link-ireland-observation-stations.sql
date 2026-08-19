-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED (expected swimloading / szgkzuswelntnevobnoh)'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-19_link-ireland-observation-stations.sql
-- ================================================================

-- Purpose:
--   The ireland_mi provider has been ingesting ~96 observations a day into
--   ZERO linked spots since it was switched on — the data arrives and
--   nothing consumes it. This links the one Irish spot that has a station
--   near enough to be worth showing.
--
--   ONLY ONE of the three Irish spots is linked. The Marine Institute
--   buoys are deep-ocean weather buoys, not coastal stations, and the
--   nearest-station distances are:
--
--     Forty Foot (Dublin)               -> M2   50.2 km   ← linked
--     Sandycove Island, Kinsale         -> M5  125.5 km   ← NOT linked
--     Blackrock Diving Tower, Salthill  -> M5  237.7 km   ← NOT linked
--
--   Dave's instruction was that a reading ~15 km away still "gives a sense
--   of the temp, not accurate but enough to plan". 50 km in the same body
--   of water (M2 sits in the Irish Sea off Dublin, as does Forty Foot)
--   still serves that purpose, and the page always states the distance.
--
--   125 km and 238 km do not. Blackrock is on the ATLANTIC west coast in
--   Galway Bay; M5 is off the south-EAST coast in the Celtic Sea — a
--   different sea round the corner of the country. Sandycove is similarly
--   far from anything. Showing those numbers would not be imprecise, it
--   would be about the wrong water, so they are left unlinked until a
--   coastal station exists. Not fabricating a temperature for a spot is
--   the standing rule.
--
--   Distance is NOT close enough to let the page claim "today's"
--   temperature: NEARBY_MEASUREMENT_TODAY_KM in api/spots-handler.js is
--   10 km, so Forty Foot will show the reading and its distance without
--   claiming it as the water at the steps.

-- Requested by:
--   Dave, 2026-08-19 ("link the Ireland spots ... enough to plan")

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Expect 0 (no Irish spot is linked yet):
-- SELECT count(*) FROM public.spot_observation_stations sos
--   JOIN public.spots s ON s.id = sos.spot_id WHERE s.country_code = 'IE';
-- Expect 1 row, Forty Foot / Irish Weather Buoy M2 / 50.2:
-- (the distance query is in the migration body below)

-- ----------------------------------------------------------------
-- BACKUP — not required: this INSERTs new link rows and updates none.
-- The rollback below removes exactly what it adds.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO public.spot_observation_stations (spot_id, station_id, distance_km, status, is_primary)
SELECT s.id, st.id,
       round((6371 * acos(least(1, greatest(-1,
           cos(radians(s.latitude)) * cos(radians(st.latitude))
         * cos(radians(st.longitude) - radians(s.longitude))
         + sin(radians(s.latitude)) * sin(radians(st.latitude))))))::numeric, 1),
       'approved', true
FROM public.spots s
JOIN public.observation_stations st ON st.name = 'Irish Weather Buoy M2'
WHERE s.name = 'Forty Foot' AND s.country_code = 'IE' AND s.active
  AND NOT EXISTS (
    SELECT 1 FROM public.spot_observation_stations x
    WHERE x.spot_id = s.id AND x.station_id = st.id
  );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.spot_observation_stations sos
--  USING public.spots s, public.observation_stations st
--  WHERE sos.spot_id = s.id AND sos.station_id = st.id
--    AND s.name = 'Forty Foot' AND st.name = 'Irish Weather Buoy M2';
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
-- Expect 1 row: Forty Foot / Irish Weather Buoy M2 / ~50.2 / approved:
-- SELECT s.name, st.name, sos.distance_km, sos.status, sos.is_primary
--   FROM public.spot_observation_stations sos
--   JOIN public.spots s ON s.id = sos.spot_id
--   JOIN public.observation_stations st ON st.id = sos.station_id
--  WHERE s.country_code = 'IE';
-- Expect a measured temperature to appear for Forty Foot:
-- SELECT name, best_source, measured_c, measured_distance_km, measured_station
--   FROM public.spot_temp_estimate e JOIN public.spots s ON s.id = e.spot_id
--  WHERE s.name = 'Forty Foot';
