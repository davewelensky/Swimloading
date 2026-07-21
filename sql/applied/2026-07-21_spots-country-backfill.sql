-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected ref: szgkzuswelntnevobnoh';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-07-21_spots-country-backfill.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Backfill country_code on the 27 active spots that have none. Each
--   country was determined from the spot's coordinates + name, NOT
--   guessed from the domain (the domain would have mislabelled the two
--   Swiss spots below). Every target code already exists in `countries`
--   (ZA domestic; CH/ES/FR/GB/IT international), so this immediately
--   corrects the domestic-vs-international classification and the SA
--   spot count.
--
--   14 South Africa, 13 international (mostly mis-parked in the
--   multi-country EUROPE domain). DESTRUCTIVE (UPDATE of 27 rows) —
--   backup table first, per MIGRATIONS.md.
--
--   NOT fixed here (adjacent DQ, flagged separately — they touch domain
--   assignment / the /spots SEO routing in EXPANDING.md's hardcode map,
--   so they belong with the EUROPE-domain split, not this safe backfill):
--     * Lac de Joux (CH) and the EUROPE spots keep a ZA/"Europe" region
--       label until the domains are split per country.
--     * Zinkwazi Lagoon is in FALSE_BAY but is actually KZN, and its
--       longitude is corrupt (3.14e16, should be ~31.44).

-- Requested by:
--   Dave (2026-07-21) — "lets get the dq right".

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM spots WHERE country_code IS NULL;  -- expect: 27
-- SELECT count(*) FROM countries WHERE iso_code IN ('ZA','GB','CH','FR','IT','ES');  -- expect: 6

-- ----------------------------------------------------------------
-- BACKUP — required (destructive). Snapshot the 27 rows before touching.
-- ----------------------------------------------------------------
-- CREATE TABLE spots_bak_20260721_country AS
--   SELECT id, name, domain, country_code, latitude, longitude
--   FROM spots WHERE country_code IS NULL;
-- SELECT count(*) FROM spots_bak_20260721_country;  -- expect: 27

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- South Africa (14)
UPDATE spots SET country_code = 'ZA' WHERE id IN (
  'e400120f-76de-4fa5-b460-70a54d2de7cb', -- Kromme River (Eastern Cape)
  'fb0ad83f-025e-40b9-a147-4c62cf65a9f8', -- Seaforth Beach (False Bay)
  '507afe1a-f5d9-4c87-9c4e-0a1b1660d4e7', -- Zinkwazi Lagoon (KZN; see coord note)
  'a2610063-86fc-4bf1-83be-579be293061e', -- Generation Schools Somerset West
  '60edc1d3-a8d1-4bab-94c0-e85209b6183e', -- River Club St Francis Bay
  '1c36f28b-9e8c-441d-b4c6-9badaf2edeca', -- Sports Science Institute Newlands
  '05ce1bc2-1284-4088-b550-794927391842', -- St Cyprian's School Aquatic Centre
  '1891f179-8e1f-4e82-8c66-d7b2e0d21437', -- Strand Pavillion indoor pool
  'bc90a591-b846-40b4-abac-97222c14e5b0', -- Virgin Active Gateway (Durban)
  '5cdd249b-70fa-4e6f-9ead-55b06d79938f', -- Virgin Active Hillcrest
  '0ab1dce4-124c-4efd-ae7b-add361ef0030', -- Virgin Active Table Bay Mall
  '534a55e8-8c34-40cb-a7da-ee9c7d1c18e0', -- Virgin Active Waterstone Village
  '268801be-f676-45cd-a3e7-e516a814a7c3', -- Virgin Active- Stellenbosch
  '423a26d0-43b9-4d0d-b1f0-7be74e662d4f'  -- Zinkwazi Beach (KZN)
);

-- United Kingdom (5)
UPDATE spots SET country_code = 'GB' WHERE id IN (
  '3affc870-1999-456d-90ec-b54431dd8f2f', -- Boscombe Beach
  'fc718acb-84f1-476f-ac35-a34edcf21aa7', -- Dover
  '47e2cc2b-e5a6-4356-a016-7181103aa464', -- Knoll Beach
  'fb19897d-801a-4f98-a0c0-5efc8ffb02a5', -- South Beach Studland
  'ce843d4e-241d-4ab0-aee8-b5d5d6560af6'  -- Torbay
);

-- France (4) — French Riviera, all near Nice
UPDATE spots SET country_code = 'FR' WHERE id IN (
  'e766c3cc-0519-4d0b-b1a9-c8d6f506ed2a', -- Beaulieu-sur-Mer
  '2fe47936-fd0f-4a00-8693-1b7ebe5ca8a5', -- eze sur meet (Èze-sur-Mer)
  '45b2203b-21d4-4817-bec2-28bfd350d7a6', -- Nice
  '2251deea-08fe-4982-8668-3c1c8e038d82'  -- Saint-Jean-Cap-Ferrat
);

-- Switzerland (2)
UPDATE spots SET country_code = 'CH' WHERE id IN (
  '9dc0b740-d408-49d8-b0ab-5fb1785e4f0a', -- Lake Zurich
  '1f1f2cd8-5fea-4674-b921-0931f783d273'  -- Lac de Joux (mis-parked in INLAND/ZA domain)
);

-- Italy (1)
UPDATE spots SET country_code = 'IT' WHERE id = '25726bb9-2113-4d3e-ab4d-e97f095e9cdf'; -- Lago di Monate

-- Spain (1)
UPDATE spots SET country_code = 'ES' WHERE id = '771ef714-161f-4e9d-8f5c-6c2960fd0b37'; -- Santa Ponça (Mallorca)

-- Coordinate fix: Zinkwazi Lagoon's longitude was corrupt (3.144e16 — the
-- decimal point dropped from 31.441642...). Restore it, matching Zinkwazi
-- Beach nearby (31.440) and the digits of the corrupt value. Backed up in
-- spots_bak_20260721_country (longitude column) above.
UPDATE spots SET longitude = 31.441642 WHERE id = '507afe1a-f5d9-4c87-9c4e-0a1b1660d4e7'; -- Zinkwazi Lagoon

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE spots s SET country_code = b.country_code
--   FROM spots_bak_20260721_country b WHERE s.id = b.id;  -- restores NULLs
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT count(*) FROM spots WHERE country_code IS NULL;  -- expect: 0
-- SELECT c.name, count(*) FROM spots s JOIN countries c ON c.iso_code = s.country_code
--   WHERE s.id IN (SELECT id FROM spots_bak_20260721_country) GROUP BY c.name ORDER BY 2 DESC;
--   -- expect: South Africa 14, United Kingdom 5, France 4, Switzerland 2, Italy 1, Spain 1
-- SELECT count(*) FILTER (WHERE active AND country_code='ZA') AS sa_active FROM spots;  -- ~138
