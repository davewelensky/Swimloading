-- ================================================================
-- SwimLoading — Migration (data correction; MIGRATIONS.md applies)
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-06_lopplistan-non-swims.sql
-- ================================================================

-- Purpose:
--   Three events from Lopplistan are live and searchable on /explore. Two
--   of them are running races. Lopplistan's own page labels every row with
--   its sport, and it says so plainly:
--
--     Kretsloppet      10.0, 5.0, 2.0, 0.4 km  Borås   Löpning  🏃‍♀️
--     Ölands Marathon  42.2 km                 Öland   Löpning  🏃‍♀️
--     Stockholm Triathlon  Stafett, Sprint, Olympisk   Triathlon 🏆
--
--   Kretsloppet is the giveaway for why a distance rule alone would not
--   have caught this: 400 m / 2 km / 5 km / 10 km are perfectly ordinary
--   open-water distances. Only the sport label distinguishes it, and we
--   ignored the label.
--
--   Handled three different ways on purpose:
--     * the two running races are UNPUBLISHED and rejected — a running
--       marathon is not a swim at any distance, and there is no discipline
--       value that would make it one (ee_discipline_check allows only
--       open_water and multisport_swim_leg);
--     * Stockholm Triathlon is KEPT and re-labelled multisport_swim_leg,
--       exactly as the nine French triathlons were on 2026-08-05. A
--       triathlon's swim leg is a real thing this catalogue carries.
--
--   Nothing is deleted. The editions stay for provenance; is_searchable
--   false is what removes them from /explore.
--
--   HOW THEY GOT IN, which this migration does NOT fix. The source is
--   correctly configured — base_url is https://lopplistan.se/sverige/simning/alla-/,
--   the swim listing. The crawler reached these events by following
--   same-site links to https://lopplistan.se/ and
--   https://lopplistan.se/sverige/alla/alla-/, the all-sports listings.
--   140 of Lopplistan's 170 candidates came from those two pages rather
--   than the configured one, and all three published events did.
--   discovery_sources has no column constraining which URLs a source may
--   expand into, so a re-crawl will find them again. That needs a schema
--   addition and is deliberately out of scope here.

-- Requested by:
--   Dave, 2026-08-06, after spotting runs and trail marathons in the queue.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------

-- 1. The three editions, all currently searchable. Expect 3.
-- SELECT e.title, e.slug, e.is_searchable, e.is_indexable, c.source_url
--   FROM event_editions e
--   JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--   JOIN discovery_sources s ON s.id = c.source_id
--  WHERE s.name ILIKE '%Lopplistan%';
--    Result 2026-08-06: 3 rows, all is_searchable = true, is_indexable = false.

-- 2. is_indexable is false on all three, so none is in the sitemap and none
--    should have been indexed. Confirms unpublishing costs no SEO.

-- 3. Nothing else in the catalogue is touched — the filter is these three
--    edition ids, written out rather than a pattern.

-- ----------------------------------------------------------------
-- BACKUP — required: this is an UPDATE.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260806_lopplistan_editions AS
--   SELECT e.* FROM event_editions e
--     JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--     JOIN discovery_sources s ON s.id = c.source_id
--    WHERE s.name ILIKE '%Lopplistan%';
-- CREATE TABLE _bak_20260806_lopplistan_candidates AS
--   SELECT c.* FROM discovery_candidate_events c
--     JOIN discovery_sources s ON s.id = c.source_id
--    WHERE s.name ILIKE '%Lopplistan%';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. The two running races: off /explore.
UPDATE event_editions
   SET is_searchable = false, is_indexable = false
 WHERE id IN (
   'ce4395ea-8256-4ddc-983a-7e7ecc2d5d26',  -- Kretsloppet — Löpning, Borås
   '22175694-aa5d-4ace-a6c5-914f0106dd6c'   -- Ölands Marathon — Löpning, 42.2 km
 );

-- The candidates stay 'approved' on purpose, and this is the schema's
-- design rather than a compromise. dce_promoted_only_when_approved is
--   CHECK (promoted_edition_id IS NULL OR candidate_status = 'approved')
-- so rejecting a candidate that has published would orphan the edition it
-- points at. The first attempt at this migration tried exactly that and
-- the constraint refused it — correctly. Once something is published, the
-- lever is the EDITION (is_searchable), not the candidate; the candidate
-- record stays true to what happened, which is that it was approved.
--
-- The decision is therefore logged as 'edited', which is what it is: the
-- edition was changed, not the review outcome reversed.
INSERT INTO discovery_review_decisions
  (candidate_id, decision, decided_by, notes, previous_status, new_status, metadata)
SELECT c.id, 'edited', NULL,
       'Not a swim: Lopplistan labels this event "Löpning" (running) on its own listing. '
       'Reached by the crawler following a link from the configured swim listing into the '
       'all-sports listing. Edition unpublished from /explore (is_searchable false); the '
       'candidate stays approved because its edition still exists and the schema requires it.',
       c.candidate_status, c.candidate_status,
       jsonb_build_object('automatic', true, 'reason', 'not_a_swim_running_event',
                          'action', 'edition_unpublished')
  FROM discovery_candidate_events c
 WHERE c.id IN ('da0d336c-290e-4f89-a1fc-bcb4842eaf18',   -- Kretsloppet
                '8a53e876-fd82-4c46-a600-3d181902f0d1');  -- Ölands Marathon

-- 2. The triathlon: kept, correctly labelled. Same treatment as the nine
--    French long-course triathlons on 2026-08-05.
--
--    Pre-check 2026-08-06 found it ALREADY multisport_swim_leg — the
--    classifier got this one right, so this statement is a deliberate
--    no-op left in for completeness and idempotence. It is not evidence
--    that anything here changed it.
UPDATE event_editions
   SET discipline = 'multisport_swim_leg'
 WHERE id = 'b5d990cb-e8bb-4637-bf70-0ec3bc56c22f'    -- Stockholm Triathlon
   AND discipline IS DISTINCT FROM 'multisport_swim_leg';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE event_editions e SET is_searchable = b.is_searchable,
--        is_indexable = b.is_indexable, discipline = b.discipline
--   FROM _bak_20260806_lopplistan_editions b WHERE b.id = e.id;
-- UPDATE discovery_candidate_events c SET candidate_status = b.candidate_status,
--        last_reviewed_at = b.last_reviewed_at
--   FROM _bak_20260806_lopplistan_candidates b WHERE b.id = c.id;
-- DELETE FROM discovery_review_decisions
--  WHERE metadata->>'reason' = 'not_a_swim_running_event';

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------

-- 1. No Lopplistan event is searchable except the triathlon. Expect 1 row,
--    Stockholm Triathlon, discipline multisport_swim_leg.
-- SELECT e.title, e.is_searchable, e.discipline FROM event_editions e
--   JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--   JOIN discovery_sources s ON s.id = c.source_id
--  WHERE s.name ILIKE '%Lopplistan%' AND e.is_searchable;

-- 2. Nothing was deleted — still 3 editions.
-- SELECT count(*) FROM event_editions e
--   JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--   JOIN discovery_sources s ON s.id = c.source_id
--  WHERE s.name ILIKE '%Lopplistan%';

-- 3. No open-water edition anywhere still carries a marathon-running
--    distance. Capri-Napoli at 36 km is a real marathon SWIM and must
--    survive this check.
-- SELECT e.title, d.distance_metres FROM event_editions e
--   JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--   JOIN discovery_candidate_distances d ON d.candidate_id = c.id
--  WHERE e.is_searchable AND d.distance_metres > 25000;
--    expected: Maratona del Golfo Capri-Napoli only
