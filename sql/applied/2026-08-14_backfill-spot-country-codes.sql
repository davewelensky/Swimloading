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
-- Migration: 2026-08-14_backfill-spot-country-codes.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Set country_code on the six active spots where it is NULL, so they stop
--   failing the indexability gate (api/_lib/indexability.js) and are no longer
--   excluded from /sitemap.xml (api/sitemap-dynamic.js).

-- Requested by:
--   Dave — countries confirmed by him, each one re-checked below against the
--   row's own domain and coordinates before being written.

-- Evidence — every code is corroborated by the row's stored coordinates,
-- not inferred from the spot name:
--
--   Paternoster                     -32.8051, 17.8928  → Paternoster, West Coast SA   domain WEST_COAST  → ZA
--   Maclear Beach                   -34.3542, 18.4720  → Cape Point / Cape of Good Hope reserve, SA
--                                                         (NOT Maclear, Eastern Cape) domain ATLANTIC    → ZA
--   Curro Durbanville               -33.8031, 18.6907  → Durbanville, Cape Town        domain INLAND      → ZA
--   Kirstenhof Primary School Pool  -34.0693, 18.4543  → Kirstenhof, Cape Town         domain INLAND      → ZA
--   Virgin Active Paarl             -33.7316, 18.9647  → Paarl, Western Cape           domain INLAND      → ZA
--   Ai Ais POOL Namibia             -27.9196, 17.4887  → Ai-Ais hot springs, |Ai-|Ais/Fish River Canyon,
--                                                         Namibia — north of the Orange River border
--                                                         (~-28.5), so inside NA, not ZA  → NA
--
-- Both target countries already exist in `countries`:
--   ZA  South Africa  is_domestic = true    → stays in the domestic water-type tabs
--   NA  Namibia       is_domestic = false   → Ai Ais moves into the International tab
--                                             and gains the gold border treatment.
--   That reclassification is intended: it is a Namibian spot.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Affected rows — expect exactly 6:
--   SELECT count(*) FROM spots WHERE active = true AND country_code IS NULL;
--
-- The rows themselves, with the evidence columns — expect the 6 above:
--   SELECT id, name, domain, area, water_type, country_code, latitude, longitude
--   FROM spots WHERE active = true AND country_code IS NULL ORDER BY name;
--
-- Target countries exist — expect 2 rows (ZA is_domestic=true, NA is_domestic=false):
--   SELECT iso_code, name, is_domestic FROM countries WHERE iso_code IN ('ZA','NA');
--
-- No INACTIVE spot is being touched by accident (informational):
--   SELECT count(*) FROM spots WHERE active = false AND country_code IS NULL;

-- ----------------------------------------------------------------
-- BACKUP — required: this migration contains an UPDATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260814_spots_country_code AS
SELECT id, name, domain, area, water_type, country_code, latitude, longitude, active
FROM spots
WHERE active = true AND country_code IS NULL;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Targeted by id (stable) rather than by name, so a future duplicate or a
-- rename cannot redirect the write. `country_code IS NULL` makes each
-- statement idempotent and means a re-run can never overwrite a code that
-- has since been set by someone else.

UPDATE spots SET country_code = 'ZA'
WHERE id = '9e6d1148-a508-4d6f-b6f5-c54c47a199f8'   -- Paternoster
  AND country_code IS NULL;

UPDATE spots SET country_code = 'ZA'
WHERE id = '4164fe42-86f1-42b3-9f5d-83c32c58ba61'   -- Maclear Beach
  AND country_code IS NULL;

UPDATE spots SET country_code = 'ZA'
WHERE id = '48c9a460-9427-4828-b6fd-c0ec0c214d37'   -- Curro Durbanville
  AND country_code IS NULL;

UPDATE spots SET country_code = 'ZA'
WHERE id = '61430432-9270-458e-a8e2-007134dda286'   -- Kirstenhof Primary School Pool
  AND country_code IS NULL;

UPDATE spots SET country_code = 'ZA'
WHERE id = 'bdca2cc8-02be-4756-a2ce-0381f8405e88'   -- Virgin Active Paarl
  AND country_code IS NULL;

UPDATE spots SET country_code = 'NA'
WHERE id = '9dfc8da7-0e5e-4a82-8536-5d472c2f7aca'   -- Ai Ais POOL Namibia
  AND country_code IS NULL;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — reversible.
-- ----------------------------------------------------------------
-- UPDATE spots s SET country_code = NULL
-- FROM _bak_20260814_spots_country_code b
-- WHERE s.id = b.id;
--
-- (The backup stores country_code as it was — NULL for all six — so this
-- restores the exact prior state. Backup table to be dropped by a later
-- migration once this has been live and verified, never in the same session.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- No active spot left without a country — expect 0:
--   SELECT count(*) FROM spots WHERE active = true AND country_code IS NULL;
--
-- The six now carry the intended codes — expect 5 × ZA and 1 × NA:
--   SELECT name, country_code FROM spots
--   WHERE id IN ('9e6d1148-a508-4d6f-b6f5-c54c47a199f8','4164fe42-86f1-42b3-9f5d-83c32c58ba61',
--                '48c9a460-9427-4828-b6fd-c0ec0c214d37','61430432-9270-458e-a8e2-007134dda286',
--                'bdca2cc8-02be-4756-a2ce-0381f8405e88','9dfc8da7-0e5e-4a82-8536-5d472c2f7aca')
--   ORDER BY name;
--
-- Every code resolves against `countries` — expect 0 orphans:
--   SELECT count(*) FROM spots s
--   LEFT JOIN countries c ON c.iso_code = s.country_code
--   WHERE s.active = true AND c.iso_code IS NULL;
--
-- Backup captured all six — expect 6:
--   SELECT count(*) FROM _bak_20260814_spots_country_code;
--
-- Then re-run the indexability gate over all 194 active spots
-- (api/_lib/indexability.js, fed from spot_temp_estimate) — expect 194/194.
