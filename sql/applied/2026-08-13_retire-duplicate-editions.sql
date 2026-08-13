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
-- Migration: 2026-08-13_retire-duplicate-editions.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   18 swims are listed TWICE on /explore. Retire the weaker copy of each,
--   carry the one fact the weaker copy held that the survivor lacked, and
--   clear 15 registration URLs that are an unrendered template placeholder.
--
--   TWO DIFFERENT CAUSES, and only one is still open.
--
--   (a) 15 oceanswims.com pairs — RESIDUE of the title-suffix bug, already
--       fixed in code. Timeline for Lorne Pier to Pub:
--         05 Aug 12:55  listing page -> "Lorne Pier to Pub"           approved
--         05 Aug 13:13  event page   -> "Lorne Pier to Pub - Ocean
--                                        Swim in Lorne VIC | oceanswims.com"
--                                                                     approved  <- 2nd edition
--         12 Aug 13:32  event page   -> "Lorne Pier to Pub"           duplicate ✓
--       At 13:13 the two names differed, so computeDuplicateScore saw no
--       match. TITLE_SUFFIX_RULES in normalize/text.ts now strips that
--       furniture, which is why the 12 Aug re-extraction deduped correctly.
--       These 15 editions are simply the ones published before the fix.
--
--   (b) 3 French pairs — a CURRENTLY OPEN hole, not fixed by this
--       migration. The same race is listed by ffneaulibre.fr and by
--       combinaison-neoprene.com, and dedupe cannot see across sources:
--       fetchExistingCandidatesForDedupe filters .eq('source_id', ...), so
--       two sources covering one race always double-publish. Left open
--       deliberately — the fix is a design decision about cross-source
--       identity, not a cleanup.
--
--   WHICH COPY SURVIVES was ranked on evidence, not on extraction method:
--   most distances, then has coordinates, then confidence. That keeps the
--   JSON-LD event-page copy for every oceanswims pair (it has a venue and
--   coordinates; the listing copy has neither) and the ffneaulibre copy for
--   every French pair (5-7 distances and confidence 65, against 1 and 45).
--
--   The survivor is not strictly better in one respect: the oceanswims
--   listing copy holds the real event URL, while the JSON-LD copy stored
--   the literal string '@post(url-entries)' — a template placeholder the
--   site never rendered. So official_url is carried across before the
--   weaker copy is retired, and the placeholder is nulled out.

-- Requested by:
--   Dave, 2026-08-13, while asking to fix the ai_fallback distances. The
--   distances turned out not to be a bug (the listing pages do not state
--   them); this was found underneath.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. There are 18 duplicate groups, each of exactly 2 live editions:
-- WITH live AS (
--   SELECT e.id, e.start_date,
--          lower(regexp_replace(split_part(split_part(e.title,'|',1),'–',1),'[^a-z0-9]+','','gi')) AS name_key
--     FROM event_editions e
--    WHERE e.is_searchable AND e.start_date >= current_date
--      AND e.status <> 'cancelled' AND e.discipline = 'open_water')
-- SELECT count(*) FROM (SELECT 1 FROM live GROUP BY name_key, start_date HAVING count(*) > 1) t;
-- expect: 18
--
-- 2. Every edition being retired is live right now (nothing already off):
-- SELECT count(*) FROM event_editions WHERE is_searchable AND id IN (
--    '2ecbe2be-65c5-4abf-8390-615799da9fd0'  -- 2026 Australian Open Water Cup (Darwin),
    'cf2f9fcb-4f14-4c0c-9295-7f86b9f868b1'  -- Anglesea Rock2Ramp,
    'dcc550a6-6e69-434e-a09e-73aada07ba7f'  -- Bluff to Bar,
    '6496d721-c615-46d6-842b-033a81ae282f'  -- Boucle des Faienciers (combinaison-neoprene copy),
    '0074ee67-b74a-46d6-91a9-c49fedbf543a'  -- Collaroy Beach Ocean Swims,
    '0602513f-7901-4661-9660-b42e0ce2c202'  -- Coogee Island Challenge Spring,
    '09c6a3da-4423-46e9-b23a-477445b8b4b2'  -- JSA Eau Libre (combinaison-neoprene copy),
    '99ca60b2-dc95-4afa-8922-a8bd527f1155'  -- Lake Boga Bank 2 Bank,
    '71789c2e-bda0-4540-8d5a-63625c9975bb'  -- Lorne Pier to Pub,
    'd807343b-feeb-4fd2-997b-7da2cf551123'  -- Magnetic Island to Townsville Swim,
    '83c2e700-5a21-49fd-b214-cbd57ea7f700'  -- Narrabeen Beach Challenge,
    '00207adb-3533-448d-b9a9-85db3ce614ab'  -- Newport Pool To Peak,
    '1fd39f38-ee70-4413-9bd1-08f0c4dffe8a'  -- Point Leo Swim Classic,
    '79c0209f-129a-4479-9551-ff5a323ba7aa'  -- Rip View Swim Classic,
    'c870b030-6270-41dc-8ab2-cc0820fa29fa'  -- Swim Thru Rotto,
    '64bcc68b-e465-421c-a7a7-4dc3fa13c580'  -- Traversee du Lac d'Annecy (combinaison-neoprene copy),
    'd6b96ac9-60c5-4236-a4bc-0fc6428e8029'  -- Victorian Open Water Championships,
    'ca50f83c-946c-41eb-aa4e-41742617bc4a'  -- Whitehaven Beach Open Water Swim
-- );
-- expect: 18
--
-- 3. Placeholder registration URLs, all on the survivors:
-- SELECT count(*) FROM event_editions WHERE registration_url LIKE '@post(%';
-- expect: 15

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs existing rows.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260813_duplicate_editions AS
--   SELECT * FROM event_editions WHERE id IN (
--     '2ecbe2be-65c5-4abf-8390-615799da9fd0'  -- 2026 Australian Open Water Cup (Darwin),
    'cf2f9fcb-4f14-4c0c-9295-7f86b9f868b1'  -- Anglesea Rock2Ramp,
    'dcc550a6-6e69-434e-a09e-73aada07ba7f'  -- Bluff to Bar,
    '6496d721-c615-46d6-842b-033a81ae282f'  -- Boucle des Faienciers (combinaison-neoprene copy),
    '0074ee67-b74a-46d6-91a9-c49fedbf543a'  -- Collaroy Beach Ocean Swims,
    '0602513f-7901-4661-9660-b42e0ce2c202'  -- Coogee Island Challenge Spring,
    '09c6a3da-4423-46e9-b23a-477445b8b4b2'  -- JSA Eau Libre (combinaison-neoprene copy),
    '99ca60b2-dc95-4afa-8922-a8bd527f1155'  -- Lake Boga Bank 2 Bank,
    '71789c2e-bda0-4540-8d5a-63625c9975bb'  -- Lorne Pier to Pub,
    'd807343b-feeb-4fd2-997b-7da2cf551123'  -- Magnetic Island to Townsville Swim,
    '83c2e700-5a21-49fd-b214-cbd57ea7f700'  -- Narrabeen Beach Challenge,
    '00207adb-3533-448d-b9a9-85db3ce614ab'  -- Newport Pool To Peak,
    '1fd39f38-ee70-4413-9bd1-08f0c4dffe8a'  -- Point Leo Swim Classic,
    '79c0209f-129a-4479-9551-ff5a323ba7aa'  -- Rip View Swim Classic,
    'c870b030-6270-41dc-8ab2-cc0820fa29fa'  -- Swim Thru Rotto,
    '64bcc68b-e465-421c-a7a7-4dc3fa13c580'  -- Traversee du Lac d'Annecy (combinaison-neoprene copy),
    'd6b96ac9-60c5-4236-a4bc-0fc6428e8029'  -- Victorian Open Water Championships,
    'ca50f83c-946c-41eb-aa4e-41742617bc4a'  -- Whitehaven Beach Open Water Swim
--   );
-- CREATE TABLE _bak_20260813_placeholder_regurl AS
--   SELECT id, registration_url, official_url, slug FROM event_editions
--    WHERE registration_url LIKE '@post(%'
--       OR id IN ('357b98b2-d30c-4769-b9b2-6b0576976f50','dcc550a6-6e69-434e-a09e-73aada07ba7f');

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Carry the real event URL onto each survivor that has none. Runs
--    BEFORE the retirement so the fact is never lost if step 2 is edited.
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/2026-australian-open-water-cup-darwin/'
 WHERE id = '12bb92db-1213-428e-9f37-aefd38a8a9f4' AND official_url IS NULL;   -- 2026 Australian Open Water Cup (Darwin)
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/anglesea-rock2ramp/'
 WHERE id = '47395c49-eae9-41d1-9a7b-f5e7f6275323' AND official_url IS NULL;   -- Anglesea Rock2Ramp
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/bluff-to-bar/'
 WHERE id = '357b98b2-d30c-4769-b9b2-6b0576976f50' AND official_url IS NULL;   -- Bluff to Bar
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/collaroy-beach-ocean-swim/'
 WHERE id = 'e6ce50c7-03d2-4301-9a85-6734c59432d1' AND official_url IS NULL;   -- Collaroy Beach Ocean Swims
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/coogee-island-challenge-spring/'
 WHERE id = 'd6a99991-8f33-4901-a574-6f32083c0b14' AND official_url IS NULL;   -- Coogee Island Challenge Spring
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/lake-boga-bank-2-bank/'
 WHERE id = '7a6e90eb-f0f4-4c47-b65d-87666b41c6ff' AND official_url IS NULL;   -- Lake Boga Bank 2 Bank
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/lorne-pier-to-pub/'
 WHERE id = '436396e0-3e97-4295-8144-7d341b37b1a9' AND official_url IS NULL;   -- Lorne Pier to Pub
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/magnetic-island-to-townsville-open-water-swim/'
 WHERE id = 'c9b2f99b-ea90-455b-b089-a1dde93a120b' AND official_url IS NULL;   -- Magnetic Island to Townsville Swim
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/narrabeen-beach-challenge/'
 WHERE id = '57a05d6a-1266-458b-8e26-ca6807a841d3' AND official_url IS NULL;   -- Narrabeen Beach Challenge
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/newport-pool-to-peak/'
 WHERE id = '39881277-a7cf-4efd-a555-852e7dc3d629' AND official_url IS NULL;   -- Newport Pool To Peak
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/point-leo-swim-classic/'
 WHERE id = '296e80af-f083-4ba7-9df6-56d3c118cc4c' AND official_url IS NULL;   -- Point Leo Swim Classic
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/rip-view-swim-classic/'
 WHERE id = '7b8405eb-43d4-40df-b711-76e679e3c543' AND official_url IS NULL;   -- Rip View Swim Classic
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/swim-thru-rotto/'
 WHERE id = '9bf2aed9-f795-49a9-8f73-82bd7fbc124d' AND official_url IS NULL;   -- Swim Thru Rotto
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/sv-victorian-open-water-championships/'
 WHERE id = '450640a8-3846-490d-ab10-9cf00cbbd916' AND official_url IS NULL;   -- Victorian Open Water Championships
UPDATE event_editions SET official_url = 'https://oceanswims.com/event/whitehaven-ocean-swim/'
 WHERE id = '28f442bf-f9c0-45d2-a079-0b79f9233727' AND official_url IS NULL;   -- Whitehaven Beach Open Water Swim

-- 2. Clear the unrendered template placeholder. '@post(url-entries)' is
--    not a URL and must never reach a swimmer as a link.
UPDATE event_editions
   SET registration_url = NULL
 WHERE registration_url LIKE '@post(%';

-- 3. Bluff to Bar keeps the better record but the worse slug: its survivor
--    is slugged from the un-stripped page title. Free the clean slug from
--    the copy being retired, then give it to the survivor.
UPDATE event_editions SET slug = 'bluff-to-bar-2026-superseded'
 WHERE id = 'dcc550a6-6e69-434e-a09e-73aada07ba7f' AND slug = 'bluff-to-bar-2026';
UPDATE event_editions SET slug = 'bluff-to-bar-2026'
 WHERE id = '357b98b2-d30c-4769-b9b2-6b0576976f50'
   AND slug = 'bluff-to-bar-ocean-swim-in-alex-surf-club-oceanswims-com-2026';

-- 4. Retire the weaker copy. is_searchable is the lever — the candidate row
--    is left alone, because dce_promoted_only_when_approved refuses a
--    status change on a promoted candidate.
UPDATE event_editions
   SET is_searchable = false,
       is_indexable  = false
 WHERE id IN (
    '2ecbe2be-65c5-4abf-8390-615799da9fd0'  -- 2026 Australian Open Water Cup (Darwin),
    'cf2f9fcb-4f14-4c0c-9295-7f86b9f868b1'  -- Anglesea Rock2Ramp,
    'dcc550a6-6e69-434e-a09e-73aada07ba7f'  -- Bluff to Bar,
    '6496d721-c615-46d6-842b-033a81ae282f'  -- Boucle des Faienciers (combinaison-neoprene copy),
    '0074ee67-b74a-46d6-91a9-c49fedbf543a'  -- Collaroy Beach Ocean Swims,
    '0602513f-7901-4661-9660-b42e0ce2c202'  -- Coogee Island Challenge Spring,
    '09c6a3da-4423-46e9-b23a-477445b8b4b2'  -- JSA Eau Libre (combinaison-neoprene copy),
    '99ca60b2-dc95-4afa-8922-a8bd527f1155'  -- Lake Boga Bank 2 Bank,
    '71789c2e-bda0-4540-8d5a-63625c9975bb'  -- Lorne Pier to Pub,
    'd807343b-feeb-4fd2-997b-7da2cf551123'  -- Magnetic Island to Townsville Swim,
    '83c2e700-5a21-49fd-b214-cbd57ea7f700'  -- Narrabeen Beach Challenge,
    '00207adb-3533-448d-b9a9-85db3ce614ab'  -- Newport Pool To Peak,
    '1fd39f38-ee70-4413-9bd1-08f0c4dffe8a'  -- Point Leo Swim Classic,
    '79c0209f-129a-4479-9551-ff5a323ba7aa'  -- Rip View Swim Classic,
    'c870b030-6270-41dc-8ab2-cc0820fa29fa'  -- Swim Thru Rotto,
    '64bcc68b-e465-421c-a7a7-4dc3fa13c580'  -- Traversee du Lac d'Annecy (combinaison-neoprene copy),
    'd6b96ac9-60c5-4236-a4bc-0fc6428e8029'  -- Victorian Open Water Championships,
    'ca50f83c-946c-41eb-aa4e-41742617bc4a'  -- Whitehaven Beach Open Water Swim
 );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE event_editions e
--    SET is_searchable = b.is_searchable, is_indexable = b.is_indexable, slug = b.slug
--   FROM _bak_20260813_duplicate_editions b WHERE e.id = b.id;
-- UPDATE event_editions e
--    SET registration_url = b.registration_url, official_url = b.official_url, slug = b.slug
--   FROM _bak_20260813_placeholder_regurl b WHERE e.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- No duplicate groups remain:
-- WITH live AS (
--   SELECT e.id, e.start_date,
--          lower(regexp_replace(split_part(split_part(e.title,'|',1),'–',1),'[^a-z0-9]+','','gi')) AS name_key
--     FROM event_editions e
--    WHERE e.is_searchable AND e.start_date >= current_date
--      AND e.status <> 'cancelled' AND e.discipline = 'open_water')
-- SELECT count(*) FROM (SELECT 1 FROM live GROUP BY name_key, start_date HAVING count(*) > 1) t;
-- expect: 0
--
-- SELECT count(*) FROM event_editions WHERE registration_url LIKE '@post(%';
-- expect: 0
--
-- SELECT slug, is_searchable FROM event_editions
--  WHERE id IN ('357b98b2-d30c-4769-b9b2-6b0576976f50','dcc550a6-6e69-434e-a09e-73aada07ba7f');
-- expect: bluff-to-bar-2026 / true, and bluff-to-bar-2026-superseded / false
--
-- SELECT total_count FROM search_events_v2(p_include_multisport := false) LIMIT 1;
-- expect: 18 fewer than before (373 -> 355)
