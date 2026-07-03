-- ================================================================
-- SwimLoading — Migration
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-07-03_add-spain-santa-ponsa.sql
-- Process:   see MIGRATIONS.md · Country checklist: EXPANDING.md
-- ================================================================

-- Purpose:
--   Add Spain as the 12th country: countries row (ES, international),
--   SPAIN domain, and the Santa Ponsa spot (Mallorca) — from Lindi's
--   approved spot suggestion (spot_suggestions 4c1c0206, 2026-07-03).
--   Coordinates: Platja de Santa Ponça, verified 39.509, 2.477.

-- Requested by:
--   Dave ("we have a swimmer logging a temp in a new spot/location in
--   spain, so its another country on our list", 2026-07-03)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM countries WHERE iso_code='ES';        -- expect 0
-- SELECT count(*) FROM domains  WHERE code='SPAIN';          -- expect 0
-- SELECT count(*) FROM spots    WHERE code='SANTA_PONSA';    -- expect 0
-- SELECT max(sort_order) FROM domains;                       -- expect 132 (FRANCE)

-- ----------------------------------------------------------------
-- BACKUP — not required: INSERT-only, no rows changed or deleted.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO countries (iso_code, name, continent, is_domestic)
VALUES ('ES', 'Spain', 'Europe', false)
ON CONFLICT (iso_code) DO NOTHING;

INSERT INTO domains (code, display_name, is_coastal, sort_order, country_code)
VALUES ('SPAIN', 'Spain', true, 133, 'ES')
ON CONFLICT (code) DO NOTHING;

INSERT INTO spots (name, code, domain, water_type, latitude, longitude, area, active, country_code)
VALUES ('Santa Ponsa', 'SANTA_PONSA', 'SPAIN', 'OCEAN', 39.5090, 2.4770, 'MALLORCA', true, 'ES');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo.
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM spots     WHERE code = 'SANTA_PONSA';
-- DELETE FROM domains   WHERE code = 'SPAIN';
-- DELETE FROM countries WHERE iso_code = 'ES';
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT iso_code, name, is_domestic FROM countries WHERE iso_code='ES';
--   -- expect: ES | Spain | false
-- SELECT code, display_name, sort_order FROM domains WHERE code='SPAIN';
--   -- expect: SPAIN | Spain | 133
-- SELECT name, code, domain, water_type, latitude, longitude, area, active, country_code
--   FROM spots WHERE code='SANTA_PONSA';
--   -- expect: Santa Ponsa | SPAIN | OCEAN | 39.509 | 2.477 | MALLORCA | true | ES
