-- ================================================================
-- SwimLoading — Migration
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT - migration aborted. Expected swimloading (szgkzuswelntnevobnoh).';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-09-29_fix-mykonos-spot-name-and-coords.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   The Mykonos spot approved from Sarah Alexander's suggestion saved with the ORIGINAL suggestion values instead of the
--   edits Dave intended: name "Mykonos greece" (should be "Mykonos") and coordinates 37.4513937, 25.3923149 (Dave's point is
--   37.4593391, 25.3250570, about 6.0 km west). Also fill the two fields the sibling European spots have: timezone and area.
--   The code MYKONOS_GREECE is left as is (it is an identifier; renaming it gains nothing).

-- Requested by:
--   Dave (29 Sep 2026).

-- Pre-checks (read-only, run 29 Sep 2026 before writing this file):
--   Spot 0d39cb83-3d52-4346-9a1b-3bbaac0f0ce9: name "Mykonos greece", domain EUROPE, country_code GR, water_type OCEAN, active.
--   Nothing depends on it: 0 temp_logs, 0 spot_water_readings. No other spot is named "Mykonos" (0).
--   The unrelated "Langebaan — Mykonos" (LB_MYKONOS, ZA) is NOT touched.
--   Rows updated: exactly 1.

-- Backup (UPDATE => required):
-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _bak_20260929_spots_mykonos AS
  SELECT * FROM spots WHERE id = '0d39cb83-3d52-4346-9a1b-3bbaac0f0ce9';

UPDATE spots
   SET name      = 'Mykonos',
       latitude  = 37.4593391,
       longitude = 25.3250570,
       timezone  = 'Europe/Athens',
       area      = 'Mykonos'
 WHERE id = '0d39cb83-3d52-4346-9a1b-3bbaac0f0ce9';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   UPDATE spots s SET name=b.name, latitude=b.latitude, longitude=b.longitude, timezone=b.timezone, area=b.area
--     FROM _bak_20260929_spots_mykonos b WHERE s.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
--   SELECT name, code, domain, country_code, latitude, longitude, timezone, area, active FROM spots WHERE id='0d39cb83-3d52-4346-9a1b-3bbaac0f0ce9';
--   -- expect: Mykonos | MYKONOS_GREECE | EUROPE | GR | 37.4593391 | 25.325057 | Europe/Athens | Mykonos | true
--   SELECT count(*) FROM _bak_20260929_spots_mykonos;   -- expect 1
