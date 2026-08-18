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
-- Migration: 2026-08-18_fix-red-beach-tillamook.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Repair two spots created from the /admin approval flow on 2026-08-18.
--   Dave asked for their coordinates to be corrected; investigating found
--   the coordinates are the smallest of four faults on each row.
--
--   WHAT IS ACTUALLY WRONG (both rows):
--     1. domain = 'ATLANTIC'. That is CAPE TOWN's Atlantic Seaboard. Both
--        US spots are therefore listed on https://www.swimloading.com/spots/atlantic
--        — verified live. The admin Add-Spot form derives a domain from the
--        country code, and with country_code NULL it fell back to the South
--        African default.
--     2. country_code = NULL, so isPublicPageIndexable() rejects them and
--        neither can ever be treated as international.
--     3. area and timezone NULL.
--     4. Coordinates are the BUOY position, not a shoreline.
--     5. Neither has an observation station linked at all
--        (spot_observation_stations = 0), so both are empty pages.
--
--   RED BEACH IS NOT A PUBLIC SWIMMING LOCATION. NDBC/CDIP station 46275
--   "Red Beach Nearshore, CA (264)" sits off Red Beach on MARINE CORPS BASE
--   CAMP PENDLETON — the amphibious landing training beach. Reverse
--   geocoding puts the buoy in San Diego County with the Camp Pendleton
--   range marker 4 km away and the base landuse polygon adjacent. Public
--   access is restricted to military personnel. No coordinate correction
--   makes this a spot SwimLoading should publish, so it is DEACTIVATED.
--
--   TILLAMOOK IS SALVAGEABLE but needs renaming. The buoy is off Bayocean
--   Peninsula; the public water access on that bay mouth is Barview Jetty
--   County Park (45.5720, -123.9517), 3.4 km from the buoy and the only
--   named public park the geocoder finds there. The spot is repointed and
--   renamed to what a swimmer would actually search for.
--
--   NOTE ON THE SLUG. Renaming changes the URL from
--   /spots/tillamook-bay-south-jetty,-or to /spots/barview-jetty. The old
--   URL was created today, is not in the sitemap yet and has no inbound
--   links, so no redirect is warranted — unlike the Santa Ponça merge,
--   where the retired slug was already indexed.

-- Requested by:
--   Dave ("fix red beach and tillamook coordinates", 2026-08-18)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Affected rows: exactly 2 spots. Verified 2026-08-18 — no other table
-- references either id (0 temp_logs, 0 station links, 0 everything else),
-- because both were created hours ago and no swimmer has used them:
-- SELECT id, name, domain, country_code, active FROM spots
--  WHERE code IN ('RED_BEACH_NEARSHORE_CA','TILLAMOOK_BAY_SOUTH_JETTY_OR');
--   -- expect: 2 rows, domain ATLANTIC, country_code NULL, active true
-- SELECT count(*) FROM temp_logs WHERE spot_id IN
--   (SELECT id FROM spots WHERE code IN ('RED_BEACH_NEARSHORE_CA','TILLAMOOK_BAY_SOUTH_JETTY_OR'));
--   -- expect: 0
-- SELECT count(*) FROM spot_observation_stations WHERE spot_id IN
--   (SELECT id FROM spots WHERE code IN ('RED_BEACH_NEARSHORE_CA','TILLAMOOK_BAY_SOUTH_JETTY_OR'));
--   -- expect: 0
-- SELECT count(*) FROM spots WHERE code='BARVIEW_JETTY';   -- expect: 0

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260818_gap_spots AS
  SELECT * FROM spots
   WHERE code IN ('RED_BEACH_NEARSHORE_CA','TILLAMOOK_BAY_SOUTH_JETTY_OR');

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Red Beach — retire. Military beach, no public access.
UPDATE spots
   SET active = false,
       domain = 'USA',
       country_code = 'US',
       meet_note = 'Retired 2026-08-18: NDBC station 46275 sits off Red Beach on Marine Corps Base Camp Pendleton, an amphibious training beach with no public access. Suggested automatically from observation coverage; not a swimming location.'
 WHERE code = 'RED_BEACH_NEARSHORE_CA';

UPDATE spot_suggestions
   SET status = 'rejected',
       admin_notes = 'Approved in error then retired: the station is off Camp Pendleton (military amphibious training beach), not a public swimming location.'
 WHERE source = 'observation_gap' AND spot_name = 'Red Beach Nearshore, CA';

-- 2. Tillamook — repoint to the real public access and name it properly.
UPDATE spots
   SET name = 'Barview Jetty',
       code = 'BARVIEW_JETTY',
       domain = 'USA',
       country_code = 'US',
       area = 'TILLAMOOK',
       timezone = 'America/Los_Angeles',
       latitude = 45.5720,
       longitude = -123.9517,
       meet_note = 'Public access at Barview Jetty County Park, on the north side of the Tillamook Bay entrance. Nearest measured water temperature is NDBC 46278, 3.4 km offshore.'
 WHERE code = 'TILLAMOOK_BAY_SOUTH_JETTY_OR';

UPDATE spot_suggestions
   SET spot_name = 'Barview Jetty',
       admin_notes = 'Approved; renamed from the station label and repointed from the buoy position to the public park at Barview Jetty.'
 WHERE source = 'observation_gap' AND spot_name = 'Tillamook Bay South Jetty, OR';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE spots s SET name=b.name, code=b.code, domain=b.domain, country_code=b.country_code,
--        area=b.area, timezone=b.timezone, latitude=b.latitude, longitude=b.longitude,
--        active=b.active, meet_note=b.meet_note
--   FROM _bak_20260818_gap_spots b WHERE b.id = s.id;
-- UPDATE spot_suggestions SET status='approved', admin_notes=NULL
--  WHERE source='observation_gap' AND spot_name IN ('Red Beach Nearshore, CA','Barview Jetty');
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT name, code, domain, country_code, area, active, latitude, longitude
--   FROM spots WHERE code IN ('RED_BEACH_NEARSHORE_CA','BARVIEW_JETTY') ORDER BY name;
--   -- expect: Barview Jetty | USA | US | TILLAMOOK | true | 45.5720, -123.9517
--   --         Red Beach Nearshore, CA | USA | US | null | FALSE
-- SELECT count(*) FROM spots WHERE domain='ATLANTIC' AND country_code IS DISTINCT FROM 'ZA';
--   -- expect: 0  — no non-South-African spot left on the Atlantic Seaboard page
