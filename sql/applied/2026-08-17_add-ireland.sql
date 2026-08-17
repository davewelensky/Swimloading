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
-- Migration: 2026-08-17_add-ireland.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Add Ireland (country IE, domain IRELAND) with three founding spots:
--   Forty Foot (Dublin), Blackrock Diving Tower Salthill (Galway),
--   Sandycove Island Kinsale (Cork). Follows EXPANDING.md Step 3.
--   Coordinates: Forty Foot geocoded exactly (OSM bathing place); Salthill
--   and Kinsale from geocoded promenade/slipway reference points — flagged
--   for Dave to fine-tune on the map if needed.

-- Requested by:
--   Dave ("apply and add ireland", 2026-08-17)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM countries WHERE iso_code = 'IE';        -- expect: 0
-- SELECT count(*) FROM domains  WHERE code = 'IRELAND';        -- expect: 0
-- SELECT count(*) FROM spots    WHERE country_code = 'IE';     -- expect: 0
-- No UPDATE/DELETE in this migration.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: INSERT-only.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO countries (iso_code, name, continent, is_domestic)
VALUES ('IE', 'Ireland', 'Europe', false)
ON CONFLICT (iso_code) DO NOTHING;

INSERT INTO domains (code, display_name, is_coastal, sort_order, country_code)
VALUES ('IRELAND', 'Ireland', true, 135, 'IE')
ON CONFLICT (code) DO NOTHING;

INSERT INTO spots (name, code, domain, water_type, latitude, longitude, area, active, country_code, timezone)
VALUES
  ('Forty Foot', 'FORTY_FOOT', 'IRELAND', 'OCEAN',
   53.289486, -6.1136988, 'DUBLIN', true, 'IE', 'Europe/Dublin'),
  ('Blackrock Diving Tower, Salthill', 'BLACKROCK_SALTHILL', 'IRELAND', 'OCEAN',
   53.2569525, -9.0923158, 'GALWAY', true, 'IE', 'Europe/Dublin'),
  ('Sandycove Island, Kinsale', 'SANDYCOVE_KINSALE', 'IRELAND', 'OCEAN',
   51.6771315, -8.5242855, 'CORK', true, 'IE', 'Europe/Dublin')
ON CONFLICT DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM spots   WHERE country_code = 'IE';
-- DELETE FROM domains WHERE code = 'IRELAND';
-- DELETE FROM countries WHERE iso_code = 'IE';
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT name, is_domestic FROM countries WHERE iso_code='IE';
--   -- expect: Ireland | false
-- SELECT code, display_name, country_code FROM domains WHERE code='IRELAND';
--   -- expect: IRELAND | Ireland | IE
-- SELECT name, domain, water_type, active FROM spots WHERE country_code='IE' ORDER BY name;
--   -- expect: 3 rows, all IRELAND/OCEAN/active
