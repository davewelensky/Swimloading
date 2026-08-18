-- ================================================================
-- SwimLoading — Migration Template
-- Copy this header into EVERY new migration file.
-- The safety block hard-fails if you are in the wrong project.
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
-- Migration: 2026-08-18_merge-santa-ponca-into-santa-ponsa.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Merge the duplicate Mallorca spot. Both rows describe the same beach,
--   created 5 hours apart on 3 July 2026:
--
--     Santa Ponça  771ef714-…  code SANTA_PON_A  39.5033, 2.4584  no area
--     Santa Ponsa  2b3ea76d-…  code SANTA_PONSA  39.5090, 2.4770  area MALLORCA
--
--   SURVIVOR: Santa Ponsa. Not because its name is more correct — "Santa
--   Ponça" is the proper Catalan spelling — but on the evidence:
--     · it sits 0.84 km from Platja de Santa Ponça (geocoded 39.5162,
--       2.4801) where Santa Ponça's row is 2.35 km away, which matters for
--       Strava's 1.5 km GPS match radius;
--     · its code is clean (SANTA_PON_A is a mangled ç);
--     · it carries area = MALLORCA;
--     · it already holds the approved primary observation station.
--
--   DEACTIVATED, NOT DELETED. temp_logs.spot_id is ON DELETE CASCADE, so
--   DELETE FROM spots would silently destroy swimmer readings. This project
--   has lost logged data to a cascade before (168 rows, 7 Jun 2026). Setting
--   active = false removes the spot from the app, the picker and SEO while
--   every row that references it survives and the change is one UPDATE to
--   reverse.
--
--   WHOSE DATA MOVES: Lindi's. One temperature log (28 °C, 4 July 2026) and
--   the June-challenge event it earned (15 points). Both are repointed to
--   the surviving spot so her reading stays visible — a log attached to an
--   inactive spot drops out of latest_spot_temps and spot_temp_estimate,
--   which would quietly erase her entry from the app.
--
--   june_challenge_events.spot_name is deliberately LEFT as 'Santa Ponça'.
--   The June challenge is finished and its leaderboard settled; that column
--   records what the feed said at the time. Repointing the foreign key is
--   housekeeping, rewriting the historical label is not.

-- Requested by:
--   Dave ("write the merge migration", 2026-08-18)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Affected-row counts (verified 2026-08-18, expect exactly these):
--   temp_logs.spot_id           = 1   (Lindi, 28 °C, 2026-07-04)
--   temp_logs.gps_spot_id       = 1   (the same row)
--   june_challenge_events       = 1   (15 points, ref_id → that log)
--   spot_observation_stations   = 1   (secondary link to buoy 61499)
--   spots (deactivated)         = 1
--   spot_water_readings         = 359 (modelled, left in place, regenerated
--                                      hourly by cron; harmless on an
--                                      inactive spot)
-- SELECT count(*) FROM temp_logs WHERE spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';           -- expect 1
-- SELECT count(*) FROM temp_logs WHERE gps_spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';       -- expect 1
-- SELECT count(*) FROM june_challenge_events WHERE spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37'; -- expect 1
-- Nothing else references it — verified against all 24 FKs to spots:
-- profiles.home_beach_id, swim_events, hazard_reports, swimming_posts,
-- fuel_tests, strava_imports, clubs, club_events, campaign_*, event_venues,
-- swim_routes, recurring_swims, swimmer_achievements, swimmer_story_events,
-- spot_suggestions.* all return 0.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260818_santa_ponca_spot AS
  SELECT * FROM spots WHERE id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';

CREATE TABLE IF NOT EXISTS _bak_20260818_santa_ponca_temp_logs AS
  SELECT * FROM temp_logs
   WHERE spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37'
      OR gps_spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';

CREATE TABLE IF NOT EXISTS _bak_20260818_santa_ponca_challenge AS
  SELECT * FROM june_challenge_events
   WHERE spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';

CREATE TABLE IF NOT EXISTS _bak_20260818_santa_ponca_stations AS
  SELECT * FROM spot_observation_stations
   WHERE spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Move Lindi's reading to the surviving spot.
UPDATE temp_logs
   SET spot_id = '2b3ea76d-9722-45c6-ae61-8efba7faf5fd'
 WHERE spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';

UPDATE temp_logs
   SET gps_spot_id = '2b3ea76d-9722-45c6-ae61-8efba7faf5fd'
 WHERE gps_spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';

-- 2. Follow it with the challenge event. points, user_id and spot_name are
--    untouched — only the foreign key moves.
UPDATE june_challenge_events
   SET spot_id = '2b3ea76d-9722-45c6-ae61-8efba7faf5fd'
 WHERE spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';

-- 3. Drop the duplicate's station link. The surviving spot already has the
--    same buoy approved as its primary, so nothing is lost; leaving it would
--    keep a link pointing at a spot no page renders.
DELETE FROM spot_observation_stations
 WHERE spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';

-- 4. Retire the duplicate. NOT a delete — see the header.
UPDATE spots
   SET active = false,
       meet_note = COALESCE(meet_note || ' ', '')
         || 'Merged into Santa Ponsa on 2026-08-18 — duplicate entry for the same beach.'
 WHERE id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE spots SET active = true, meet_note = (SELECT meet_note FROM _bak_20260818_santa_ponca_spot)
--  WHERE id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';
-- UPDATE temp_logs t SET spot_id = b.spot_id, gps_spot_id = b.gps_spot_id
--   FROM _bak_20260818_santa_ponca_temp_logs b WHERE b.id = t.id;
-- UPDATE june_challenge_events e SET spot_id = b.spot_id
--   FROM _bak_20260818_santa_ponca_challenge b WHERE b.id = e.id;
-- INSERT INTO spot_observation_stations SELECT * FROM _bak_20260818_santa_ponca_stations
--   ON CONFLICT DO NOTHING;
-- COMMIT;
-- (Also revert the /spots/santa-ponca redirect in vercel.json.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT name, active FROM spots WHERE name ILIKE 'Santa Pon%' ORDER BY name;
--   -- expect: Santa Ponsa | true, Santa Ponça | false
-- SELECT count(*) FROM temp_logs WHERE spot_id = '2b3ea76d-9722-45c6-ae61-8efba7faf5fd';
--   -- expect: 1  (Lindi's 28 °C reading, now on the surviving spot)
-- SELECT count(*) FROM temp_logs WHERE spot_id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37';
--   -- expect: 0  — and 1 still in _bak_20260818_santa_ponca_temp_logs
-- SELECT user_id, points, spot_name FROM june_challenge_events
--  WHERE spot_id = '2b3ea76d-9722-45c6-ae61-8efba7faf5fd';
--   -- expect: 1 row, 15 points, spot_name still 'Santa Ponça' (by design)
-- SELECT (SELECT count(*) FROM _bak_20260818_santa_ponca_temp_logs) AS logs_backed_up,
--        (SELECT count(*) FROM _bak_20260818_santa_ponca_challenge) AS events_backed_up;
--   -- expect: 1, 1
