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
-- Migration: 2026-08-18_approve-waimea-santa-monica.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Approve two observation-gap suggestions into real spots: Waimea Bay
--   (Oahu) and Santa Monica Beach (California), and close the suggestions
--   with created_spot_id.
--
--   COORDINATES ARE THE BEACH, NOT THE BUOY. The suggestions carried the
--   station's position, because that is the only location a sensor can
--   prove. Creating spots there would have put Santa Monica 21 km out in
--   the bay and Waimea 6.6 km offshore: wrong on the map, wrong for Strava
--   GPS matching (1.5 km radius), and wrong for the swimmer. Both were
--   geocoded via the project's existing Nominatim proxy (/api/geocode) and
--   the beach coordinates used instead:
--
--     Waimea Bay        21.6403, -158.0633   (natural/beach, Oahu — NOT the
--                                             Kauai bay of the same name)
--     Santa Monica Beach 34.0103, -118.4979  (Santa Monica State Beach, by
--                                             the pier)
--
--   A consequence worth recording: at the real Santa Monica location the
--   nearest station is no longer the mid-bay buoy 46221 that produced the
--   suggestion (21.4 km away) but the Santa Monica Pier gauge 9410840, at
--   0.3 km. Matching is re-run after this migration; approval of that link
--   remains a separate human decision.

-- Requested by:
--   Dave ("approve waimea bay and santa monica", 2026-08-18)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- 1. Codes are free (expect: 0):
-- SELECT count(*) FROM spots WHERE code IN ('WAIMEA_BAY','SANTA_MONICA_BEACH');
-- 2. No existing spot within 300 m of either coordinate — the same
--    duplicate guard admin.html applies (expect: 0):
-- SELECT name FROM spots WHERE active
--   AND (  (abs(latitude - 21.6403) < 0.01 AND abs(longitude + 158.0633) < 0.01)
--       OR (abs(latitude - 34.0103) < 0.01 AND abs(longitude + 118.4979) < 0.01));
-- 3. FKs exist (expect: 1 each):
-- SELECT count(*) FROM domains WHERE code='USA';
-- SELECT count(*) FROM countries WHERE iso_code='US';
-- 4. The two suggestions are pending (expect: 2 rows, status pending):
-- SELECT spot_name, status FROM spot_suggestions
--  WHERE source='observation_gap' AND spot_name IN ('Waimea Bay, HI','Santa Monica Bay, CA');
-- The UPDATE below touches exactly those 2 suggestion rows.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- The UPDATE sets status/created_spot_id/reviewed_at on 2 machine-generated
-- suggestion rows created earlier today. They hold no user data (user_id is
-- NULL by construction) and the rollback below restores them to 'pending',
-- so a backup table would preserve nothing the rollback does not.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO spots (name, code, domain, water_type, latitude, longitude, area, active, country_code, timezone)
VALUES
  ('Waimea Bay', 'WAIMEA_BAY', 'USA', 'OCEAN',
   21.6403, -158.0633, 'OAHU', true, 'US', 'Pacific/Honolulu'),
  ('Santa Monica Beach', 'SANTA_MONICA_BEACH', 'USA', 'OCEAN',
   34.0103, -118.4979, 'LOS_ANGELES', true, 'US', 'America/Los_Angeles');

-- Close the suggestions that produced them.
UPDATE spot_suggestions
   SET status = 'approved',
       created_spot_id = (SELECT id FROM spots WHERE code = 'WAIMEA_BAY'),
       reviewed_at = now()
 WHERE source = 'observation_gap' AND spot_name = 'Waimea Bay, HI';

UPDATE spot_suggestions
   SET status = 'approved',
       created_spot_id = (SELECT id FROM spots WHERE code = 'SANTA_MONICA_BEACH'),
       reviewed_at = now()
 WHERE source = 'observation_gap' AND spot_name = 'Santa Monica Bay, CA';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE spot_suggestions SET status='pending', created_spot_id=NULL, reviewed_at=NULL
--  WHERE source='observation_gap' AND spot_name IN ('Waimea Bay, HI','Santa Monica Bay, CA');
-- DELETE FROM spot_observation_stations
--  WHERE spot_id IN (SELECT id FROM spots WHERE code IN ('WAIMEA_BAY','SANTA_MONICA_BEACH'));
-- DELETE FROM spots WHERE code IN ('WAIMEA_BAY','SANTA_MONICA_BEACH');
-- COMMIT;
-- (Safe while no swimmer has logged a temperature at either spot; temp_logs
--  would block the delete and should be checked first.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT name, code, domain, area, country_code, latitude, longitude, timezone
--   FROM spots WHERE code IN ('WAIMEA_BAY','SANTA_MONICA_BEACH') ORDER BY name;
--   -- expect: 2 rows, USA/OCEAN/US, coordinates as above
-- SELECT spot_name, status, created_spot_id IS NOT NULL AS linked
--   FROM spot_suggestions WHERE source='observation_gap' AND status='approved';
--   -- expect: 2 rows, both linked
-- SELECT count(*) FROM spot_suggestions WHERE source='observation_gap' AND status='pending';
--   -- expect: 23 (25 filed, 2 approved)
