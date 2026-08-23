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
-- Migration: 2026-08-23_restore-precise-regular-swim-coords.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Two Claude sessions fixed the same reported bug ("regular group swims
--   don't show on the map") within ~15 minutes of each other on 2026-08-22:
--   this session (sql/applied/2026-08-20_recurring-swim-coordinates.sql,
--   using spot-centre coordinates as a labelled approximation) and a
--   separate session (sql/applied/2026-08-22_locate-regular-group-swims.sql,
--   using MEETING-POINT coordinates Dave supplied directly, verified
--   against each spot's distance and water_type). This session's
--   unconditional UPDATE landed second and silently overwrote the better
--   data. This migration restores it.
--
--   Two real regressions from the overwrite, not just precision:
--     - Hot Chocolate Swim got linked to spot 'fbffa7a3' (Camps Bay Beach),
--       which is INACTIVE. The other session's migration explicitly
--       checked `s.active` before linking and chose spot '28b8542c'
--       (Camps Bay), which is active — this session's migration didn't
--       check activity at all. An inactive spot_id likely breaks the
--       water-temperature blend the group-swim detail page shows.
--     - PodSquad North Cottesloe's `notes` field still claims "coordinates
--       approximated... no independently verified pin yet", which became
--       false the moment the precise value existed. Cleared here — the
--       other migration never set notes on either row, so there is
--       nothing to preserve.
--
--   Hot Chocolate Swim's rich `notes` (Dave's first-hand account, added in
--   commit 6a51a56) was never touched by either coordinates migration and
--   is untouched by this one too.

-- Requested by:
--   Dave (surfaced when he asked to check the other session's changes for
--   conflicts with this session's)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT id, slug, latitude, longitude, spot_id, notes FROM recurring_swims
--   WHERE id IN ('381eaf90-96c2-4985-bd6d-08d3ff775f7a','813d7709-51b9-4cd5-96ce-00c63cfd2abc');
--   -- expect: this session's (wrong) values currently live —
--   -- hot-chocolate at -33.952/18.3776 linked to fbffa7a3 (inactive);
--   -- podsquad at -31.9958596036927/115.750240802209 with the stale
--   -- "approximated" note
--
-- SELECT id, name, water_type, active FROM spots WHERE id = '28b8542c-65af-4cd2-b214-58ccafb11637';
--   -- expect: "Camps Bay", OCEAN, active = true

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260823_recurring_swims_coord_fix AS
SELECT * FROM recurring_swims
WHERE id IN ('381eaf90-96c2-4985-bd6d-08d3ff775f7a', '813d7709-51b9-4cd5-96ce-00c63cfd2abc');

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Hot Chocolate Swim — restore the meeting-point coordinate and the
-- active spot link.
UPDATE recurring_swims
SET latitude = -33.9505641069856,
    longitude = 18.378382758493377,
    spot_id = '28b8542c-65af-4cd2-b214-58ccafb11637',
    updated_at = now()
WHERE id = '381eaf90-96c2-4985-bd6d-08d3ff775f7a';

-- PodSquad North Cottesloe — restore the meeting-point coordinate;
-- spot_id was never touched by this session's migration so it is already
-- correct (Cottesloe Beach, 37eb8c47). Clear the now-false "approximated"
-- note rather than leave stale internal documentation.
UPDATE recurring_swims
SET latitude = -31.989151376768643,
    longitude = 115.75181501323412,
    notes = NULL,
    updated_at = now()
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
-- FROM _bak_20260823_recurring_swims_coord_fix b
-- WHERE r.id = b.id;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT r.id, r.slug, r.latitude, r.longitude, r.spot_id, r.notes, s.active AS spot_active
--   FROM recurring_swims r LEFT JOIN spots s ON s.id = r.spot_id
--   WHERE r.id IN ('381eaf90-96c2-4985-bd6d-08d3ff775f7a','813d7709-51b9-4cd5-96ce-00c63cfd2abc');
--   -- expect: hot-chocolate at -33.9505641069856/18.378382758493377,
--   -- spot_id 28b8542c, spot_active = true;
--   -- podsquad at -31.989151376768643/115.75181501323412, notes NULL
