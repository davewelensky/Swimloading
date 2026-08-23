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
-- Migration: 2026-08-20_recurring-swim-coordinates.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Neither of the 2 public recurring_swims rows had latitude/longitude,
--   so today's /explore map fix (explore.html, "Regular group swims" mode
--   now plots its own coordinates instead of the dated-events pins) left
--   that tab's map empty — correct instead of wrong, but Dave asked for
--   the pins. Fills both from the site's own verified `spots` table:
--     - Hot Chocolate Swim (Camps Bay Beach, Cape Town): exact match —
--       "Camps Bay Beach" spot, and its meeting point (Café Caprice) is
--       on that beach. Also links spot_id for data lineage.
--     - PodSquad North Cottesloe (Perth): APPROXIMATE ONLY. North
--       Cottesloe Beach is a distinct beach ~1km north of the "Cottesloe
--       Beach" spot we have on file (different surf club) — no verified
--       spot exists for it. Using the nearby spot's coordinates as a
--       close-enough map pin, flagged in `notes` (an internal field, not
--       shown to visitors) rather than presented as exact. spot_id is
--       deliberately left NULL — it is not actually that spot.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT id, name, latitude, longitude, spot_id, notes FROM recurring_swims
--   WHERE id IN ('381eaf90-96c2-4985-bd6d-08d3ff775f7a','813d7709-51b9-4cd5-96ce-00c63cfd2abc');
--   -- expect: both rows have latitude/longitude/spot_id NULL. PodSquad's
--   -- notes is also NULL. Hot Chocolate Swim's notes is NOT null (Dave's
--   -- own sourcing note from 2026-08-13, about distance/safety fields —
--   -- unrelated to coordinates) and this migration does not touch it.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260820b_recurring_swims AS
SELECT * FROM recurring_swims
WHERE id IN ('381eaf90-96c2-4985-bd6d-08d3ff775f7a', '813d7709-51b9-4cd5-96ce-00c63cfd2abc');

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Hot Chocolate Swim — Camps Bay Beach, exact match, spot_id linked.
UPDATE recurring_swims
SET latitude = -33.952,
    longitude = 18.3776,
    spot_id = 'fbffa7a3-5b97-4815-a2fc-ff7e3c99ad0b'
WHERE id = '381eaf90-96c2-4985-bd6d-08d3ff775f7a';

-- PodSquad North Cottesloe — approximated from the nearby Cottesloe Beach
-- spot; spot_id intentionally left NULL, see Purpose above.
UPDATE recurring_swims
SET latitude = -31.9958596036927,
    longitude = 115.750240802209,
    notes = 'Coordinates approximated from the nearby Cottesloe Beach spot '
         || '(~1km south) for map display — North Cottesloe Beach/Surf Club '
         || 'itself has no independently verified pin yet. Confirm the exact '
         || 'meeting-point coordinates if precision starts to matter.'
WHERE id = '813d7709-51b9-4cd5-96ce-00c63cfd2abc';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE recurring_swims r
-- SET latitude = b.latitude, longitude = b.longitude,
--     spot_id = b.spot_id, notes = b.notes
-- FROM _bak_20260820b_recurring_swims b
-- WHERE r.id = b.id;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT id, name, latitude, longitude, spot_id, notes FROM recurring_swims
--   WHERE id IN ('381eaf90-96c2-4985-bd6d-08d3ff775f7a','813d7709-51b9-4cd5-96ce-00c63cfd2abc');
--   -- expect: Hot Chocolate Swim has lat=-33.952 lng=18.3776 spot_id set;
--   -- PodSquad North Cottesloe has lat=-31.9958596036927 lng=115.750240802209,
--   -- spot_id NULL, notes explaining the approximation
