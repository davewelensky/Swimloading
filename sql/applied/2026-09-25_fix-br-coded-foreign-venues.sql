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
-- Migration: 2026-09-25_fix-br-coded-foreign-venues.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Correct event_venues.country_code on 10 venues stored as 'BR' (Brazil)
--   whose own stored name names another country, in Portuguese. The homepage
--   feed's new country flags made one visible: "Razanac (Croácia), Brazil"
--   with a Brazilian flag. All 10 came from the discovery source
--   "Swimchannel Brasil — calendário águas abertas", whose source country
--   (BR) was applied to every event it lists, including foreign ones written
--   "City (Country)". Each correction is taken from that row's own text:
--     Razanac (Croácia)                   BR -> HR   circuito europeu 4a etapa, 26 Sep
--     Barcelona (Espanha)                 BR -> ES   circuito europeu 5a etapa, 3 Oct
--     Tenero (Suíça)                      BR -> CH   circuito europeu 3a etapa, 5 Sep
--     Baku (Azerbaijão)                   BR -> AZ   world aquatics copa do mundo 1a etapa, 1 Oct
--     Tashkent (Uzbequistão)              BR -> UZ   world aquatics copa do mundo 2a etapa, 8 Oct
--     Astana (Cazaquistão)                BR -> KZ   world aquatics copa do mundo 3a etapa, 15 Oct
--     Lima (Peru)                         BR -> PE   world series paralympic 8a etapa, 12 Nov
--     Abu Dhabi (Emirados Árabes Unidos)  BR -> AE   world series paralympic 9a etapa, 26 Nov
--     Santa Fé (Argentina)                BR -> AR   campeonato mundial junior, 3 Sep
--     Rosário e Santa Fé (Argentina)      BR -> AR   jogos sul-americanos, 12 Sep
--   Only country_code changes. City/display text and the missing coordinates
--   are left as they are (no geocoding guesses).
--
--   Durability: event_venues rows are only ever INSERTed (by
--   approve_discovery_candidate, which reuses an existing venue by
--   canonical_name), never updated by any code path, so a re-crawl of the
--   same listing reuses these corrected rows. NEW foreign listings from that
--   source will still arrive as BR until the discovery worker is changed —
--   separate follow-up.

-- Requested by:
--   Dave, 25 Sep 2026 ("fix Razanac"; widened to the 9 identical rows found
--   while checking — same source, same pattern, same kind of evidence)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- P1. Exhaustive finder: every BR venue whose bracketed suffix is NOT a
--     Brazilian state code (SP, RJ, SC, ... or "SP e RJ"):
-- SELECT id, display_name FROM event_venues
--  WHERE country_code = 'BR' AND coalesce(display_name, city) ~ '\([^)]*\)'
--    AND substring(coalesce(display_name, city) from '\(([^)]*)\)') !~
--      '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)([ /,e]+(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO))*$';
-- result (dry-run 25 Sep): exactly the 10 rows listed above, all BR, each
--     with exactly 1 edition. The other 42 BR venues are Brazilian (bracket
--     is a state code, or no bracket).
--
-- P2. Constraint: event_venues_country_code_check requires ^[A-Z]{2}$ — all
--     10 new values comply. No FK to countries, so no countries rows needed.
--
-- P3. Side effects: one BEFORE UPDATE trigger (trg_touch_event_venues) sets
--     updated_at. /api/explore/events caches for 5 min (s-maxage=300), so
--     the homepage feed and /explore reflect the change within ~5-15 min.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260925_event_venues_br_country AS
SELECT * FROM event_venues WHERE id IN (
  '503ea727-eedb-4f63-99d9-48a28fad0965', 'cdb873e5-95e3-4a25-bf7f-8fb28df5bc81',
  '0b27ac19-5447-4185-8aa8-0b1cbc66f51d', '2a92ffe3-8a51-493a-82cd-3b4fd0ad82ce',
  'efcc0457-9e31-485f-9ea0-3b1e8b4fb466', '0c576afb-289f-44c9-bdce-52988f821d61',
  '4e5b672f-9030-4227-aeda-63b575c764f1', '1f3ba764-6f59-4cc1-8b8c-ee5891e39212',
  'b9b1944e-0b6c-446b-9777-8ddc806b6273', 'a5791ac3-893f-4a94-82cc-42d36a1246c3');

ALTER TABLE _bak_20260925_event_venues_br_country ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON _bak_20260925_event_venues_br_country FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_updated integer;
BEGIN
  IF (SELECT count(*) FROM _bak_20260925_event_venues_br_country WHERE country_code = 'BR') <> 10 THEN
    RAISE EXCEPTION 'Backup does not hold the 10 BR rows. Aborting.';
  END IF;

  UPDATE event_venues v
     SET country_code = m.correct
    FROM (VALUES
      ('503ea727-eedb-4f63-99d9-48a28fad0965'::uuid, 'Razanac (Croácia)',                  'HR'),
      ('cdb873e5-95e3-4a25-bf7f-8fb28df5bc81'::uuid, 'Barcelona (Espanha)',                'ES'),
      ('0b27ac19-5447-4185-8aa8-0b1cbc66f51d'::uuid, 'Tenero (Suíça)',                     'CH'),
      ('2a92ffe3-8a51-493a-82cd-3b4fd0ad82ce'::uuid, 'Baku (Azerbaijão)',                  'AZ'),
      ('efcc0457-9e31-485f-9ea0-3b1e8b4fb466'::uuid, 'Tashkent (Uzbequistão)',             'UZ'),
      ('0c576afb-289f-44c9-bdce-52988f821d61'::uuid, 'Astana (Cazaquistão)',               'KZ'),
      ('4e5b672f-9030-4227-aeda-63b575c764f1'::uuid, 'Lima (Peru)',                        'PE'),
      ('1f3ba764-6f59-4cc1-8b8c-ee5891e39212'::uuid, 'Abu Dhabi (Emirados Árabes Unidos)', 'AE'),
      ('b9b1944e-0b6c-446b-9777-8ddc806b6273'::uuid, 'Santa Fé (Argentina)',               'AR'),
      ('a5791ac3-893f-4a94-82cc-42d36a1246c3'::uuid, 'Rosário e Santa Fé (Argentina)',     'AR')
    ) AS m(id, expected_name, correct)
   WHERE v.id = m.id
     AND v.country_code = 'BR'
     AND v.display_name = m.expected_name;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 10 THEN
    RAISE EXCEPTION 'Expected to update 10 venues, updated %. Rolling back.', v_updated;
  END IF;
END $$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- UPDATE event_venues v SET country_code = b.country_code
--   FROM _bak_20260925_event_venues_br_country b WHERE v.id = b.id;   -- 10 rows back to BR

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- V1. SELECT display_name, country_code FROM event_venues
--      WHERE id IN (SELECT id FROM _bak_20260925_event_venues_br_country) ORDER BY 1;
-- expect: Abu Dhabi (Emirados Árabes Unidos) AE, Astana (Cazaquistão) KZ,
--         Baku (Azerbaijão) AZ, Barcelona (Espanha) ES, Lima (Peru) PE,
--         Razanac (Croácia) HR, Rosário e Santa Fé (Argentina) AR,
--         Santa Fé (Argentina) AR, Tashkent (Uzbequistão) UZ, Tenero (Suíça) CH
--
-- V2. Re-run the P1 finder. expect: 0 rows.
--
-- V3. Live, ~5-15 min after apply (feed cache): the homepage card reads
--     "Razanac (Croácia), Croatia" with a Croatian flag.
--
-- APPLIED 2026-09-25 via supabase-admin apply_migration
-- (2026_09_25_fix_br_coded_foreign_venues), after Dave typed "apply".
-- V1 pass: all 10 rows now carry the country named in their own text.
-- V2 pass: 0 BR venues left whose bracket names another country (42 BR
-- venues remain, all Brazilian). Backup holds the 10 original BR rows.
