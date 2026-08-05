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
-- Migration: 2026-08-05_country-resolution-backfill.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Backfill country_code on the 22 candidates (and their venues) whose
--   country WAS on the page all along and which the location parser failed
--   to read. The parser is fixed in the same ship; this repairs the rows
--   already stored, because unchanged pages are never re-extracted (the
--   page-hash cache skips them) so the fix cannot reach them by itself.
--
--   Every value below was produced by running the FIXED parser over each
--   row's own stored raw_source_values —
--   discovery-worker/scripts/replay-country-resolution.ts --sql — not by
--   anyone deciding what country an event looks like it is in. Re-run that
--   script to regenerate this list from scratch.
--
--   Two gaps caused it, both ours, neither a missing fact on the page:
--     A. the country name lookup held twelve hand-typed entries, so
--        "Philippines", "Greece" and "Australia" all read as no country;
--     B. the JSON-LD path never applied the US-state/CA-province inference
--        the free-text path already had, so addressRegion "FL"/"TX"/"AK"/
--        "HI" resolved to nothing while addressCountry sat empty.
--
--   Consequence being fixed: Caramoan was in the database while the
--   Philippines read zero events — invisible to country chips, country
--   hubs and country search. Sixteen Australian swims likewise.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------

-- 1. Expect 95 countryless candidates, of which exactly 22 are targeted.
-- SELECT count(*) FROM discovery_candidate_events WHERE country_code IS NULL;

-- 2. Expect 22 — every id below still exists AND is still countryless.
--    If this is not 22, the replay script must be re-run: something has
--    changed since the list was generated, and applying a stale list would
--    overwrite a value someone or something else has since set.
-- SELECT count(*) FROM discovery_candidate_events c
--   JOIN (VALUES <the id list below>) AS t(id, code) ON t.id = c.id
--  WHERE c.country_code IS NULL;

-- 3. Expect 9 countryless venues, of which 7 are reached by this backfill.
--    The two left alone are correct and must STAY null:
--      "North Wales"  — UK vs Pennsylvania, 5,406 km apart, refused on purpose
--      "Guaymas, SON" — Mexican state codes are three letters; unsupported
-- SELECT count(*) FROM event_venues WHERE country_code IS NULL;

-- 4. Eleven of the targeted candidates hang off a venue that ALREADY has a
--    country — set by the geocoder, not by this parser. The UPDATE's
--    IS NULL guard leaves them alone, but they are the best check we have
--    that the fix is right: two independent routes to the same answer.
--    Expect 11 rows, every one "agrees". A single "DISAGREES" means stop
--    and work out which source is wrong before applying anything.
-- SELECT v.display_name, v.country_code AS venue_says, t.code AS parser_says,
--        CASE WHEN v.country_code = t.code THEN 'agrees' ELSE 'DISAGREES' END
--   FROM (VALUES <the id list below>) AS t(id, code)
--   JOIN event_editions e ON e.source_candidate_id = t.id
--   JOIN event_venues v ON v.id = e.venue_id
--  WHERE v.country_code IS NOT NULL;
--    Result 2026-08-05: 11 rows, 11 agree (all AU). Nothing disagreed.

-- ----------------------------------------------------------------
-- BACKUP — required: this is an UPDATE.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260805_candidate_country AS
--   SELECT id, country_code, city, region, location_text
--     FROM discovery_candidate_events WHERE country_code IS NULL;
-- CREATE TABLE _bak_20260805_venue_country AS
--   SELECT id, country_code, city, region, location_text
--     FROM event_venues WHERE country_code IS NULL;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE _country_backfill (candidate_id uuid PRIMARY KEY, country_code text NOT NULL)
  ON COMMIT DROP;

INSERT INTO _country_backfill (candidate_id, country_code) VALUES
  ('694bb9b0-9fec-4956-acce-010c481049fe'::uuid, 'AU'),  -- Whitehaven Beach, Whitsundays
  ('29c04012-7342-439b-9255-cc5046a0bc21'::uuid, 'AU'),  -- Swim Thru Rotto, Rottnest Island
  ('b87ad22c-411c-436e-bf22-76304b62f5d4'::uuid, 'AU'),  -- Lorne Pier to Pub
  ('f8946e0b-0da3-4d37-936d-0037dc612078'::uuid, 'AU'),  -- Narrabeen Beach Challenge
  ('2fd1176e-2ff8-4c6c-b784-d87c88aac213'::uuid, 'AU'),  -- Lake Boga Bank 2 Bank
  ('5e73db6d-ef4d-4d2a-94b2-62394127a4d4'::uuid, 'AU'),  -- Newport Pool To Peak
  ('be9af21f-d3a7-4588-bf76-cc08837259cd'::uuid, 'AU'),  -- Rip View Swim Classic
  ('0c141a85-8bc8-401a-9aab-08e71c6f8f32'::uuid, 'AU'),  -- Magnetic Island to Townsville
  ('1bf463f7-c665-4428-add1-4baa9c94eda1'::uuid, 'AU'),  -- Collaroy Beach Ocean Swims
  ('52078826-0006-4d8a-99a3-ebc6ff4026b5'::uuid, 'AU'),  -- Australian Open Water Cup, Darwin
  ('3afff224-1df8-4cbb-8934-f662c09cb222'::uuid, 'AU'),  -- Swimrun Australia: Gold Coast
  ('d5997a20-a2e0-4461-9a65-44858949a584'::uuid, 'AU'),  -- Bluff to Bar, Alexandra Headland
  ('dfc936e9-412d-4c0e-896f-dbdc0316c33f'::uuid, 'AU'),  -- Bondi to Bronte
  ('8cfe3519-09d2-47dc-8bf2-f364261bb602'::uuid, 'AU'),  -- Swimrun Australia: Sydney North
  ('de3326d8-4f7a-4764-ba77-b31942ebfaf4'::uuid, 'AU'),  -- Coogee Island Challenge
  ('3320c2bb-42cc-42df-becf-09de5af8afc0'::uuid, 'AU'),  -- Victorian Open Water Champs
  ('869fb126-3d3b-4d8e-8a50-58d19e9c9d81'::uuid, 'US'),  -- 57 North Challenge, Sitka AK
  ('ba14fda2-7eb7-4586-9863-bac6cd28d3b3'::uuid, 'US'),  -- Kukio Blue Water, Kailua Kona HI
  ('8751ddcd-c404-4575-869b-bbb947f6f9a3'::uuid, 'US'),  -- SWIM MIAMI 27, Miami FL
  ('d9e7f462-dd06-42d6-bb0d-d1ced18f1061'::uuid, 'US'),  -- Adapted Luau, Fort Worth TX
  ('12534c08-a8c7-4b36-95c4-098b74d82947'::uuid, 'PH'),  -- Swimjunkie CARAMOAN, Pili
  ('0b0cde80-b3a6-4f9a-a6ce-bdf77316ee7d'::uuid, 'GR');  -- XTERRA Greece, Voula

-- Only ever fills a hole. The IS NULL guard means re-running this changes
-- nothing, and a country set by any other route always wins.
UPDATE discovery_candidate_events c
   SET country_code = b.country_code,
       updated_at   = now()
  FROM _country_backfill b
 WHERE c.id = b.candidate_id
   AND c.country_code IS NULL;

-- Venues follow their candidate through the edition that promoted it.
UPDATE event_venues v
   SET country_code = b.country_code
  FROM _country_backfill b
  JOIN event_editions e ON e.source_candidate_id = b.candidate_id
 WHERE v.id = e.venue_id
   AND v.country_code IS NULL;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE discovery_candidate_events c SET country_code = NULL
--   FROM _bak_20260805_candidate_country b WHERE b.id = c.id;
-- UPDATE event_venues v SET country_code = NULL
--   FROM _bak_20260805_venue_country b WHERE b.id = v.id;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------

-- 1. Countryless candidates: 95 -> 73. None of the 22 still null.
-- SELECT count(*) FROM discovery_candidate_events WHERE country_code IS NULL;

-- 2. Countryless venues: 9 -> 2, and the 2 survivors are the right ones.
-- SELECT display_name, city, region, location_text
--   FROM event_venues WHERE country_code IS NULL ORDER BY display_name;
--   expected exactly: "Guaymas", "North Wales"

-- 3. The headline: the Philippines and Australia stop reading zero.
-- SELECT country_code, count(*) AS venues
--   FROM event_venues WHERE country_code IN ('PH','AU','GR','US')
--  GROUP BY country_code ORDER BY country_code;

-- 4. No country was invented for a venue with no location to read it from.
-- SELECT count(*) FROM event_venues
--  WHERE country_code IS NOT NULL AND city IS NULL AND location_text IS NULL;
--   expected 0
