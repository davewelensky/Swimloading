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
-- Migration: 2026-08-13_retire-non-swim-editions.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Retire 20 live "open water swims" that are not swims. The code fix
--   (title-signal rules in extract/classify.ts) stops these being created
--   from the next crawl on; this removes the ones already published.
--
--   19 come from Uimaliitto, the Finnish federation, whose calendar covers
--   every aquatic discipline on one page — we were taking the lot. Of its
--   21 live events exactly ONE is an open-water swim (Avovesiuinnin
--   SM-kilpailut, the national championships), and that one is untouched
--   here. The 20th is Durban Undersea Club's Ponto Dive Trip, a scuba trip.
--
--   The title said so in every case, which is why the rules are TITLE-ONLY:
--     "(25m)"            the pool the gala is swum in      12 events
--     koulutus/utbildning/leiri   a course or a camp        6 events
--     uimahypyt / dive   a different sport                  2 events
--
--   Body text could not have decided this. The federation runs open-water
--   swimming too, so its pages are full of open-water vocabulary whatever
--   the event is.
--
--   NOT COVERED, and left live deliberately: "FinnCup 3 Tampere" is a pool
--   cup whose title states nothing at all. No title rule can reach it
--   without guessing, and guessing is what these rules exist to avoid.
--   It needs a different signal or a human.

-- Requested by:
--   Dave, 2026-08-13 — "we have picked up many runs, not swims in finland
--   and the nordics", then "do 1 - title signal rules". (For the record:
--   they are not runs. No Nordic event matches any running vocabulary;
--   Denmark's 8 and Sweden's 1 are all genuine swims. The contamination is
--   pool galas, courses and diving, all from this one Finnish source.)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM event_editions WHERE is_searchable AND id IN (
--    'ff489035-be15-4ac0-ad7f-c069e423fea9'  -- Funktionärsutbildning (2.kl) — officials training,
    '6394b280-6223-496b-9646-6e1073c8ad8a'  -- Taitouinnin TASO 1 -valmentajakoulutuksen lajiosuus — artistic-swimming coach course,
    '9cf25622-6278-4bcf-a25b-7065438685d9'  -- Uimahyppyjen alueleiri (taso 2) — diving camp,
    'a3a45095-e668-4258-9653-65d44043782c'  -- Uinnin kilpailunjohtajakoulutus — referee course,
    'ef33869e-d54c-4bf4-970e-e76e6774d782'  -- Vesipallon TASO 2 -valmentajakoulutus 2026 — water-polo coach course,
    '16c37b55-a7b6-425f-a173-493167115544'  -- Vesitaiturit -ohjaajakoulutus — instructor course,
    'b91e8f71-e564-4a2b-92c9-6959dd2e3ecf'  -- Ponto Dive Trip — scuba trip (DUC),
    'e0586bc7-12cc-4dfa-bc82-a4f7e2459aff'  -- Uimahyppyjen lokakuun kansallinen kilpailu — diving competition,
    '5f471c0c-598e-4f70-b9a1-b5e7d9701721'  -- HäUs-Uinnit 2026 (25m) — 25 m pool gala,
    '5aa1f139-199f-4e81-ac8f-dc9b356ccfc9'  -- Hessun Vinstat 2026 (25m) — 25 m pool gala,
    '09989390-9d91-45f2-bbd1-f541d9ef1f62'  -- Japi Rosama -uinnit (25m) — 25 m pool gala,
    'dacc4276-0331-407f-9c03-653a1371aa17'  -- Kaukaveden Syyssprintit 2026 (25m) — 25 m pool gala,
    '7b486062-d548-4654-a2e4-f429ed324ed0'  -- Krokotiili-uinnit (25m) — 25 m pool gala,
    '33a98b43-69fc-41bb-a5ec-e9362ea41303'  -- Nääs-uinnit 2026 (25m) — 25 m pool gala,
    '4b184b45-9312-4a86-8af1-3367311390c0'  -- Ollgrenit 2026 (25m) — 25 m pool gala,
    '88774df0-e693-4e3e-9a22-cc2c223f4a89'  -- Prisma uinnit 2026 (25m) — 25 m pool gala,
    'b9872d3f-b44c-400e-bfa9-b5b669f92a01'  -- RiUS-uinnit (25m) — 25 m pool gala,
    '59eac923-bfee-49bf-a2df-ee407badcf52'  -- Speedo Cup 2026 (25m) — 25 m pool gala,
    'b8231cdb-6708-4186-bf94-323a05cb5687'  -- Syysuinnit Salo 2026 (25m) — 25 m pool gala,
    '7f115a5f-4e74-4fb9-8701-92302ec660e7'  -- Vantaan Pärskeet 2026 (25m) — 25 m pool gala
-- );
-- expect: 20
--
-- The one Finnish event that must SURVIVE:
-- SELECT title, is_searchable FROM event_editions
--  WHERE title ILIKE 'Avovesiuinnin SM-kilpailut%';
-- expect: 1 row, is_searchable = true (and still true afterwards)

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs existing rows.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260813_non_swim_editions AS
--   SELECT * FROM event_editions WHERE id IN (
--     'ff489035-be15-4ac0-ad7f-c069e423fea9'  -- Funktionärsutbildning (2.kl) — officials training,
    '6394b280-6223-496b-9646-6e1073c8ad8a'  -- Taitouinnin TASO 1 -valmentajakoulutuksen lajiosuus — artistic-swimming coach course,
    '9cf25622-6278-4bcf-a25b-7065438685d9'  -- Uimahyppyjen alueleiri (taso 2) — diving camp,
    'a3a45095-e668-4258-9653-65d44043782c'  -- Uinnin kilpailunjohtajakoulutus — referee course,
    'ef33869e-d54c-4bf4-970e-e76e6774d782'  -- Vesipallon TASO 2 -valmentajakoulutus 2026 — water-polo coach course,
    '16c37b55-a7b6-425f-a173-493167115544'  -- Vesitaiturit -ohjaajakoulutus — instructor course,
    'b91e8f71-e564-4a2b-92c9-6959dd2e3ecf'  -- Ponto Dive Trip — scuba trip (DUC),
    'e0586bc7-12cc-4dfa-bc82-a4f7e2459aff'  -- Uimahyppyjen lokakuun kansallinen kilpailu — diving competition,
    '5f471c0c-598e-4f70-b9a1-b5e7d9701721'  -- HäUs-Uinnit 2026 (25m) — 25 m pool gala,
    '5aa1f139-199f-4e81-ac8f-dc9b356ccfc9'  -- Hessun Vinstat 2026 (25m) — 25 m pool gala,
    '09989390-9d91-45f2-bbd1-f541d9ef1f62'  -- Japi Rosama -uinnit (25m) — 25 m pool gala,
    'dacc4276-0331-407f-9c03-653a1371aa17'  -- Kaukaveden Syyssprintit 2026 (25m) — 25 m pool gala,
    '7b486062-d548-4654-a2e4-f429ed324ed0'  -- Krokotiili-uinnit (25m) — 25 m pool gala,
    '33a98b43-69fc-41bb-a5ec-e9362ea41303'  -- Nääs-uinnit 2026 (25m) — 25 m pool gala,
    '4b184b45-9312-4a86-8af1-3367311390c0'  -- Ollgrenit 2026 (25m) — 25 m pool gala,
    '88774df0-e693-4e3e-9a22-cc2c223f4a89'  -- Prisma uinnit 2026 (25m) — 25 m pool gala,
    'b9872d3f-b44c-400e-bfa9-b5b669f92a01'  -- RiUS-uinnit (25m) — 25 m pool gala,
    '59eac923-bfee-49bf-a2df-ee407badcf52'  -- Speedo Cup 2026 (25m) — 25 m pool gala,
    'b8231cdb-6708-4186-bf94-323a05cb5687'  -- Syysuinnit Salo 2026 (25m) — 25 m pool gala,
    '7f115a5f-4e74-4fb9-8701-92302ec660e7'  -- Vantaan Pärskeet 2026 (25m) — 25 m pool gala
--   );

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE event_editions
   SET is_searchable = false,
       is_indexable  = false
 WHERE id IN (
    'ff489035-be15-4ac0-ad7f-c069e423fea9'  -- Funktionärsutbildning (2.kl) — officials training,
    '6394b280-6223-496b-9646-6e1073c8ad8a'  -- Taitouinnin TASO 1 -valmentajakoulutuksen lajiosuus — artistic-swimming coach course,
    '9cf25622-6278-4bcf-a25b-7065438685d9'  -- Uimahyppyjen alueleiri (taso 2) — diving camp,
    'a3a45095-e668-4258-9653-65d44043782c'  -- Uinnin kilpailunjohtajakoulutus — referee course,
    'ef33869e-d54c-4bf4-970e-e76e6774d782'  -- Vesipallon TASO 2 -valmentajakoulutus 2026 — water-polo coach course,
    '16c37b55-a7b6-425f-a173-493167115544'  -- Vesitaiturit -ohjaajakoulutus — instructor course,
    'b91e8f71-e564-4a2b-92c9-6959dd2e3ecf'  -- Ponto Dive Trip — scuba trip (DUC),
    'e0586bc7-12cc-4dfa-bc82-a4f7e2459aff'  -- Uimahyppyjen lokakuun kansallinen kilpailu — diving competition,
    '5f471c0c-598e-4f70-b9a1-b5e7d9701721'  -- HäUs-Uinnit 2026 (25m) — 25 m pool gala,
    '5aa1f139-199f-4e81-ac8f-dc9b356ccfc9'  -- Hessun Vinstat 2026 (25m) — 25 m pool gala,
    '09989390-9d91-45f2-bbd1-f541d9ef1f62'  -- Japi Rosama -uinnit (25m) — 25 m pool gala,
    'dacc4276-0331-407f-9c03-653a1371aa17'  -- Kaukaveden Syyssprintit 2026 (25m) — 25 m pool gala,
    '7b486062-d548-4654-a2e4-f429ed324ed0'  -- Krokotiili-uinnit (25m) — 25 m pool gala,
    '33a98b43-69fc-41bb-a5ec-e9362ea41303'  -- Nääs-uinnit 2026 (25m) — 25 m pool gala,
    '4b184b45-9312-4a86-8af1-3367311390c0'  -- Ollgrenit 2026 (25m) — 25 m pool gala,
    '88774df0-e693-4e3e-9a22-cc2c223f4a89'  -- Prisma uinnit 2026 (25m) — 25 m pool gala,
    'b9872d3f-b44c-400e-bfa9-b5b669f92a01'  -- RiUS-uinnit (25m) — 25 m pool gala,
    '59eac923-bfee-49bf-a2df-ee407badcf52'  -- Speedo Cup 2026 (25m) — 25 m pool gala,
    'b8231cdb-6708-4186-bf94-323a05cb5687'  -- Syysuinnit Salo 2026 (25m) — 25 m pool gala,
    '7f115a5f-4e74-4fb9-8701-92302ec660e7'  -- Vantaan Pärskeet 2026 (25m) — 25 m pool gala
 );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE event_editions e
--    SET is_searchable = b.is_searchable, is_indexable = b.is_indexable
--   FROM _bak_20260813_non_swim_editions b WHERE e.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM event_editions WHERE is_searchable AND id IN (
--    'ff489035-be15-4ac0-ad7f-c069e423fea9'  -- Funktionärsutbildning (2.kl) — officials training,
    '6394b280-6223-496b-9646-6e1073c8ad8a'  -- Taitouinnin TASO 1 -valmentajakoulutuksen lajiosuus — artistic-swimming coach course,
    '9cf25622-6278-4bcf-a25b-7065438685d9'  -- Uimahyppyjen alueleiri (taso 2) — diving camp,
    'a3a45095-e668-4258-9653-65d44043782c'  -- Uinnin kilpailunjohtajakoulutus — referee course,
    'ef33869e-d54c-4bf4-970e-e76e6774d782'  -- Vesipallon TASO 2 -valmentajakoulutus 2026 — water-polo coach course,
    '16c37b55-a7b6-425f-a173-493167115544'  -- Vesitaiturit -ohjaajakoulutus — instructor course,
    'b91e8f71-e564-4a2b-92c9-6959dd2e3ecf'  -- Ponto Dive Trip — scuba trip (DUC),
    'e0586bc7-12cc-4dfa-bc82-a4f7e2459aff'  -- Uimahyppyjen lokakuun kansallinen kilpailu — diving competition,
    '5f471c0c-598e-4f70-b9a1-b5e7d9701721'  -- HäUs-Uinnit 2026 (25m) — 25 m pool gala,
    '5aa1f139-199f-4e81-ac8f-dc9b356ccfc9'  -- Hessun Vinstat 2026 (25m) — 25 m pool gala,
    '09989390-9d91-45f2-bbd1-f541d9ef1f62'  -- Japi Rosama -uinnit (25m) — 25 m pool gala,
    'dacc4276-0331-407f-9c03-653a1371aa17'  -- Kaukaveden Syyssprintit 2026 (25m) — 25 m pool gala,
    '7b486062-d548-4654-a2e4-f429ed324ed0'  -- Krokotiili-uinnit (25m) — 25 m pool gala,
    '33a98b43-69fc-41bb-a5ec-e9362ea41303'  -- Nääs-uinnit 2026 (25m) — 25 m pool gala,
    '4b184b45-9312-4a86-8af1-3367311390c0'  -- Ollgrenit 2026 (25m) — 25 m pool gala,
    '88774df0-e693-4e3e-9a22-cc2c223f4a89'  -- Prisma uinnit 2026 (25m) — 25 m pool gala,
    'b9872d3f-b44c-400e-bfa9-b5b669f92a01'  -- RiUS-uinnit (25m) — 25 m pool gala,
    '59eac923-bfee-49bf-a2df-ee407badcf52'  -- Speedo Cup 2026 (25m) — 25 m pool gala,
    'b8231cdb-6708-4186-bf94-323a05cb5687'  -- Syysuinnit Salo 2026 (25m) — 25 m pool gala,
    '7f115a5f-4e74-4fb9-8701-92302ec660e7'  -- Vantaan Pärskeet 2026 (25m) — 25 m pool gala
-- );
-- expect: 0
--
-- Uimaliitto should be left with exactly its one real open-water event:
-- SELECT e.title FROM event_editions e
--   JOIN discovery_candidate_events c ON c.promoted_edition_id = e.id
--   JOIN discovery_sources s ON s.id = c.source_id
--  WHERE e.is_searchable AND e.start_date >= current_date
--    AND s.name LIKE 'Uimaliitto%';
-- expect: Avovesiuinnin SM-kilpailut 2026, and FinnCup 3 Tampere (see note above)
--
-- SELECT total_count FROM search_events_v2(p_include_multisport := false) LIMIT 1;
-- expect: 20 fewer (355 -> 335)
