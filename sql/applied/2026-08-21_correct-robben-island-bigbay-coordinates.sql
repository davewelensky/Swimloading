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
-- Migration: 2026-08-21_correct-robben-island-bigbay-coordinates.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Dave supplied a corrected Robben Island start point (from a map pin:
--   33°48.788'S 18°22.911'E -> -33.813133, 18.381850) and the standard
--   Robben Island -> Big Bay finish point (-33.793584, 18.456890), saying
--   "we have marked the start of all robben island incorrect". Applies to
--   BOTH the live app's spot pins (spots.RBNI, spots.bigbay — used for temp
--   logging, marine-temp cron, Strava GPS spot-matching) and the Big Bay
--   Events historical swim archive (historical_routes, feeds
--   marathon-swims.html). Scoped ONLY to rows where Robben Island or Big
--   Bay is an actual start/end endpoint — other endpoints on multi-leg or
--   unrelated routes (3 Anchor Bay, Melkbos, Dassen Island, Camps Bay,
--   Milnerton, and lap-style "Around Robben Island" / "Robben Island
--   Adventure") are left untouched; no coordinates were supplied for them
--   and none are invented here.
--
--   Old spots.RBNI / old historical_routes RI-start value (-33.8069,
--   18.3671) was ~1.4km off the corrected point. Old historical_routes
--   Big Bay-end value (-33.7297, 18.4611) was ~7km off the corrected
--   finish point — spots.bigbay (-33.7914, 18.4584) was already close
--   (~240m off) but is being aligned to the same exact standard finish
--   point for consistency across the app and the archive.

-- Requested by:
--   Dave (relaying a corrected map pin)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT id, name, code, latitude, longitude FROM spots
--   WHERE id IN ('fcab5b95-a84a-4c46-aa62-cdc95252424f','72f88914-cb8e-45ce-b0f1-c17c436157d1');
--   -- expect: 2 rows — Robben Island (RBNI) -33.8069/18.3671, Big Bay (bigbay) -33.7914/18.4584
--
-- SELECT id, name, start_lat, start_lng, end_lat, end_lng FROM historical_routes
--   WHERE id IN (
--     '516101b0-6c99-4ce7-a129-ed32be11c4bc','8b9d2fcc-9d00-4a4a-b060-708b3571ddb6',
--     'bdfac9b0-a67d-4af2-8a80-84cd9102eb3f','8ccfff6a-c82b-40c9-8ba3-409d43bdf766',
--     '846918e6-bcab-4169-a65b-17716d39adf6','893c6e1c-254f-4948-ac1e-313298361de9',
--     '0c3a25cf-f134-400c-ab6a-dbbb822ecc54','c7853d8a-1bc3-458e-ad2c-ffb64c5ef8a7',
--     '86487936-cf03-45f7-a2f4-c6f29fbf6739','67fd858a-7ad8-41f0-a073-9435cf64ed0c',
--     '90ea9231-6997-4d40-a25b-84d0cc98219a','dbd9c811-ce7a-4416-ac5c-d2744973aba1',
--     'fb771eba-28fe-4598-8421-01bb5d28b092'
--   );
--   -- expect: 13 rows total. Only 2 (0c3a25cf, dbd9c811) have non-NULL
--   -- coords today; the other 11 are NULL and will be populated for the
--   -- first time on the RI or Big Bay side only (never both, unless the
--   -- route genuinely is RI<->Big Bay).

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260821_spots AS
SELECT * FROM spots
WHERE id IN ('fcab5b95-a84a-4c46-aa62-cdc95252424f', '72f88914-cb8e-45ce-b0f1-c17c436157d1');

CREATE TABLE _bak_20260821_historical_routes AS
SELECT * FROM historical_routes
WHERE id IN (
  '516101b0-6c99-4ce7-a129-ed32be11c4bc', '8b9d2fcc-9d00-4a4a-b060-708b3571ddb6',
  'bdfac9b0-a67d-4af2-8a80-84cd9102eb3f', '8ccfff6a-c82b-40c9-8ba3-409d43bdf766',
  '846918e6-bcab-4169-a65b-17716d39adf6', '893c6e1c-254f-4948-ac1e-313298361de9',
  '0c3a25cf-f134-400c-ab6a-dbbb822ecc54', 'c7853d8a-1bc3-458e-ad2c-ffb64c5ef8a7',
  '86487936-cf03-45f7-a2f4-c6f29fbf6739', '67fd858a-7ad8-41f0-a073-9435cf64ed0c',
  '90ea9231-6997-4d40-a25b-84d0cc98219a', 'dbd9c811-ce7a-4416-ac5c-d2744973aba1',
  'fb771eba-28fe-4598-8421-01bb5d28b092'
);

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Live app spot pins
UPDATE spots SET latitude = -33.813133, longitude = 18.381850
WHERE id = 'fcab5b95-a84a-4c46-aa62-cdc95252424f'; -- Robben Island (RBNI)

UPDATE spots SET latitude = -33.793584, longitude = 18.456890
WHERE id = '72f88914-cb8e-45ce-b0f1-c17c436157d1'; -- Big Bay (bigbay)

-- historical_routes: Robben Island as START
UPDATE historical_routes
SET start_lat = -33.813133, start_lng = 18.381850,
    start_location = COALESCE(start_location, 'Murray''s Bay Harbour (Robben Island)')
WHERE id IN (
  '516101b0-6c99-4ce7-a129-ed32be11c4bc', -- Robben Island - 3 Anchor Bay
  '8b9d2fcc-9d00-4a4a-b060-708b3571ddb6', -- Robben Island - 3Anchor Bay
  'bdfac9b0-a67d-4af2-8a80-84cd9102eb3f', -- Robben Island - Big Bay
  '8ccfff6a-c82b-40c9-8ba3-409d43bdf766', -- Robben Island - Big Bay (Covert Escape)
  '846918e6-bcab-4169-a65b-17716d39adf6', -- Robben Island - Dassen Island
  '893c6e1c-254f-4948-ac1e-313298361de9', -- Robben Island - Melkbos
  '0c3a25cf-f134-400c-ab6a-dbbb822ecc54', -- Robben Island — Big Bay
  'c7853d8a-1bc3-458e-ad2c-ffb64c5ef8a7'  -- RI - Dassen Island - Relay
);

-- historical_routes: Robben Island as END
UPDATE historical_routes
SET end_lat = -33.813133, end_lng = 18.381850,
    end_location = COALESCE(end_location, 'Murray''s Bay Harbour (Robben Island)')
WHERE id IN (
  '86487936-cf03-45f7-a2f4-c6f29fbf6739', -- 3 Anchor Bay - Robben Island
  '67fd858a-7ad8-41f0-a073-9435cf64ed0c', -- Big Bay - Robben Island
  '90ea9231-6997-4d40-a25b-84d0cc98219a'  -- Camps Bay - Robben Island
);

-- historical_routes: Big Bay as START
UPDATE historical_routes
SET start_lat = -33.793584, start_lng = 18.456890,
    start_location = COALESCE(start_location, 'Big Bay (Bloubergstrand)')
WHERE id IN (
  '67fd858a-7ad8-41f0-a073-9435cf64ed0c', -- Big Bay - Robben Island
  'dbd9c811-ce7a-4416-ac5c-d2744973aba1'  -- Robben Island Double — Big Bay
);

-- historical_routes: Big Bay as END
UPDATE historical_routes
SET end_lat = -33.793584, end_lng = 18.456890,
    end_location = COALESCE(end_location, 'Big Bay (Bloubergstrand)')
WHERE id IN (
  'bdfac9b0-a67d-4af2-8a80-84cd9102eb3f', -- Robben Island - Big Bay
  '8ccfff6a-c82b-40c9-8ba3-409d43bdf766', -- Robben Island - Big Bay (Covert Escape)
  'fb771eba-28fe-4598-8421-01bb5d28b092', -- Milnerton - Robben Island - Big Bay
  'dbd9c811-ce7a-4416-ac5c-d2744973aba1', -- Robben Island Double — Big Bay
  '0c3a25cf-f134-400c-ab6a-dbbb822ecc54'  -- Robben Island — Big Bay
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE spots s SET latitude = b.latitude, longitude = b.longitude
-- FROM _bak_20260821_spots b WHERE s.id = b.id;
--
-- UPDATE historical_routes r
-- SET start_lat = b.start_lat, start_lng = b.start_lng,
--     end_lat = b.end_lat, end_lng = b.end_lng,
--     start_location = b.start_location, end_location = b.end_location
-- FROM _bak_20260821_historical_routes b WHERE r.id = b.id;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT id, name, latitude, longitude FROM spots
--   WHERE id IN ('fcab5b95-a84a-4c46-aa62-cdc95252424f','72f88914-cb8e-45ce-b0f1-c17c436157d1');
--   -- expect: RBNI -33.813133/18.381850, bigbay -33.793584/18.456890
--
-- SELECT name, start_lat, start_lng, end_lat, end_lng FROM historical_routes
--   WHERE id IN (13 ids above);
--   -- expect: every RI endpoint = -33.813133/18.381850, every Big Bay
--   -- endpoint = -33.793584/18.456890; non-RI/non-BigBay endpoints
--   -- (3 Anchor Bay, Melkbos, Dassen Island, Camps Bay, Milnerton) still NULL
