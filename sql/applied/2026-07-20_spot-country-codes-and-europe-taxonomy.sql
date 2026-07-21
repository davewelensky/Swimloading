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
-- Migration: 2026-07-20_spot-country-codes-and-europe-taxonomy.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Backfill country_code on the 27 spots missing it (per-spot, GPS-verified —
--   NOT inferred from domain), repoint 7 spots sitting in the wrong domain, fix
--   one corrupt longitude, and backfill country_code on the USA /
--   WESTERN_AUSTRALIA domain rows. Data + taxonomy only — no code changes.

-- Requested by:
--   Dave (found during Phase 2.5 Swim Passport discovery, 2026-07-20)

-- APPLIED:
--   Steps 1-7 applied 2026-07-20/21 OUTSIDE the MCP workflow (dashboard).
--   Step 8 applied 2026-07-21 via supabase-admin.
--   All VERIFY queries below re-run 2026-07-21 and passing.
--   NOTE: _bak_20260720_spots was created AFTER steps 1-7 had already been
--   applied, so it holds POST-fix state and is NOT a valid restore source.
--   _bak_20260720_domains IS valid (captured USA/WESTERN_AUSTRALIA pre-fix).

-- ----------------------------------------------------------------
-- PRE-CHECKS — already run read-only. Results:
-- ----------------------------------------------------------------
-- spots WHERE country_code IS NULL                        -> 27 rows (23 with logs)
-- of those, EUROPE domain                                 -> 7 rows
-- spots with GPS outside their country_code bounding box  -> 0 rows
-- spots with corrupt/missing coords                       -> 1 row (Zinkwazi Lagoon)
-- domains WHERE country_code IS NULL                      -> 2 rows (USA, WESTERN_AUSTRALIA)
--
-- NOTE: the domain fallback is NOT safe. Lac de Joux (Switzerland, 46.64/6.29)
-- sits in the INLAND domain whose country_code is ZA. Backfilling from
-- domains.country_code would have labelled a Swiss lake South African.
-- Every value below was derived from the spot's own GPS coordinates.

-- ----------------------------------------------------------------
-- BACKUP — required (this migration UPDATEs)
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260720_spots AS
  SELECT * FROM spots
  WHERE country_code IS NULL
     OR code IN ('ZINKWAZI_LAGOON','LAC_DE_JOUX','SANTA_PON_A',
                 'BEAULIEU_SUR_MER','EZE_SUR_MEET','NICE','SAINT_JEAN_CAP_FERRAT');

CREATE TABLE _bak_20260720_domains AS
  SELECT * FROM domains WHERE country_code IS NULL;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. South African spots (14) — all GPS-confirmed inside the ZA bounding box
UPDATE spots SET country_code = 'ZA'
WHERE country_code IS NULL
  AND code IN (
    'KROMME_RIVER','SEAFORTH_BEACH','ZINKWAZI_LAGOON','ZINKWAZI_BEACH',
    'GENERATION_SCHOOLS_SOMERSET_WEST','RIVER_CLUB_ST_FRANCIS_BAY',
    'SPORTS_SCIENCE_INSTITUTE_NEWLANDS','ST_CYPRIAN_S_SCHOOL_AQUATIC_CENTRE',
    'STRAND_PAVILLION_INDOOR_POOL','VIRGIN_ACTIVE_GATEWAY','VIRGIN_ACTIVE_HILLCREST',
    'VIRGIN_ACTIVE_TABLE_BAY_MALL','VIRGIN_ACTIVE_WATERSTONE_VILLAGE',
    'VIRGIN_ACTIVE_STELLENBOSCH'
  );

-- 2. United Kingdom spots (5)
UPDATE spots SET country_code = 'GB'
WHERE country_code IS NULL
  AND code IN ('BOSCOMBE_BEACH','DOVER','KNOLL_BEACH','SOUTH_BEACH_STUDLAND','TORBAY');

-- 3. French Riviera spots (4) — country + move to the existing FRANCE domain,
--    which is already fully wired (DOMAIN_MAP, REGION_DOMAINS, INTERNATIONAL_DOMAINS,
--    SAFETY_GROUP, REGION_INTROS). No code change needed.
UPDATE spots SET country_code = 'FR', domain = 'FRANCE'
WHERE code IN ('BEAULIEU_SUR_MER','EZE_SUR_MEET','NICE','SAINT_JEAN_CAP_FERRAT');

-- 4. Santa Ponça (Mallorca) — move to the existing SPAIN domain
UPDATE spots SET country_code = 'ES', domain = 'SPAIN', area = 'MALLORCA'
WHERE code = 'SANTA_PON_A';

-- 5. Remaining EUROPE spots — country only, domain unchanged.
--    EUROPE stays a deliberate multi-country domain (see note at bottom).
UPDATE spots SET country_code = 'IT' WHERE code = 'LAGO_DI_MONATE';
UPDATE spots SET country_code = 'CH' WHERE code = 'LAKE_ZURICH';

-- 6. Lac de Joux — Swiss lake wrongly filed under the ZA "INLAND" domain.
--    Without this it would render on /spots/inland alongside SA pools.
UPDATE spots SET country_code = 'CH', domain = 'EUROPE' WHERE code = 'LAC_DE_JOUX';

-- 7. Zinkwazi Lagoon — wrong domain (KZN river mouth, not False Bay) and a
--    corrupt longitude (31441642095336200 = decimal point lost).
--    Sibling Zinkwazi Beach sits at 31.4404. Fixing this restores marine-temp
--    cron coverage and Strava GPS matching for the spot.
UPDATE spots SET domain = 'KZN', longitude = 31.4416420953362
WHERE code = 'ZINKWAZI_LAGOON';

-- 8. Latent: domain rows missing country_code (their spots are already correct)
UPDATE domains SET country_code = 'US' WHERE code = 'USA'               AND country_code IS NULL;
UPDATE domains SET country_code = 'AU' WHERE code = 'WESTERN_AUSTRALIA' AND country_code IS NULL;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE spots s SET country_code = b.country_code, domain = b.domain,
--                    longitude = b.longitude, area = b.area
--   FROM _bak_20260720_spots b WHERE b.id = s.id;
-- UPDATE domains d SET country_code = b.country_code
--   FROM _bak_20260720_domains b WHERE b.code = d.code;

-- ----------------------------------------------------------------
-- VERIFY — run read-only after applying.
-- ----------------------------------------------------------------
-- 1) No spot left without a country:
--    SELECT count(*) FROM spots WHERE country_code IS NULL;          -- expect: 0
--
-- 2) No spot's GPS contradicts its country, no corrupt coords:
--    (re-run the pre-check bounding-box query)                        -- expect: 0 rows
--
-- 3) EUROPE is now CH + IT only (PT Cascais still there):
--    SELECT country_code, count(*) FROM spots WHERE domain='EUROPE'
--    GROUP BY 1;                        -- expect: CH 5, IT 2, PT 1
--
-- 4) FRANCE / SPAIN picked up their spots:
--    SELECT domain, count(*) FROM spots WHERE domain IN ('FRANCE','SPAIN')
--    GROUP BY 1;                        -- expect: FRANCE 6, SPAIN 2
--
-- 5) Every domain resolves to exactly one country, EXCEPT the documented
--    multi-country EUROPE:
--    SELECT domain, array_agg(DISTINCT country_code) FROM spots
--    GROUP BY 1 HAVING count(DISTINCT country_code) > 1;
--                                       -- expect: EUROPE only
--
-- 6) No domain row missing a country:
--    SELECT count(*) FROM domains WHERE country_code IS NULL;         -- expect: 0
--
-- 7) Log counts unchanged (this migration must not touch temp_logs):
--    SELECT count(*) FROM temp_logs;    -- expect: same as before

-- ----------------------------------------------------------------
-- NOTE — why EUROPE is NOT being split into per-country domains
-- ----------------------------------------------------------------
-- The brief proposed splitting EUROPE into SWITZERLAND / ITALY / PORTUGAL.
-- That is not needed and carries live-SEO risk: api/seo-utils.js already
-- resolves EUROPE spots per-country via REGION_COUNTRY_FILTER (switzerland→CH,
-- portugal→PT), EUROPE_COUNTRY_MAP and getLocationLabel(). /spots/switzerland
-- and /spots/portugal are defined as REGION_DOMAINS['switzerland'] = ['EUROPE']
-- filtered by country_code — renaming or splitting the domain would break both
-- live pages and require touching DOMAIN_MAP, REGION_DOMAINS,
-- INTERNATIONAL_DOMAINS, SAFETY_GROUP + 5 safety objects, and growth-hub.html.
-- Correct country_code on every spot is what the app and the Passport actually
-- need. EUROPE is therefore a DELIBERATE multi-country domain, resolved by
-- country_code — documented here and in EXPANDING.md.
-- Follow-up (not this migration): Italy has no dedicated country page. Adding
-- one is the EXPANDING.md "new country" path — REGION_COUNTRY_FILTER['italy']='IT'
-- + REGION_DOMAINS['italy']=['EUROPE'] + intro + site-config slug.
