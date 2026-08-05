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
-- Migration: 2026-08-05_fix-triathlon-misclassification.sql
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: 0 triathlon-sourced editions
--            remain open_water; open-water count 259 -> 250; total editions
--            unchanged at 270 (nothing deleted); still reachable with
--            p_include_multisport => true; France open-water 34 -> 23.
-- ================================================================

-- Purpose:
--   Nine triathlons are live on /explore labelled as open-water swims.
--   Correct their discipline so they are shown as what they are.
--
--   How it happened: a local crawl run at ~08:5x on 2026-08-05 published 11
--   editions from two pages on combinaison-neoprene.com whose URLs are
--   literally /courses/calendrier-triathlon-ironman/ and
--   /courses/calendrier-triathlon-half-ironman/. The classifier reads page
--   content and event names, and caught only the two with "Ironman" in the
--   title. Embrunman, VentouxMan, VautourMan, Natureman, BearMan,
--   Brenn'Triman, TriaLong, EDF Vercorsman XL and Challenge Vieux Boucau
--   are all long-course triathlons whose names contain no word the
--   classifier recognises.
--
--   Embrunman in particular is one of the hardest long-course triathlons in
--   the world. Offering it to a swimmer as an open-water swim they might
--   enter is the same class of error as the Midmar start waves.
--
--   NOT deleted, and NOT unpublished. A triathlon's swim leg is a real
--   thing this catalogue carries — the 2026-08-04 rule is explicit that
--   discipline is separate from event type. Setting discipline correctly
--   hides them from /explore's default view (which shows open water only
--   unless the viewer opts legs in) while keeping the data.

-- Requested by:
--   Caught during verification of the local crawl, 2026-08-05.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. The rows this will change (expect 9, all currently open_water):
--      SELECT e.title, e.discipline, c.source_url
--        FROM event_editions e
--        JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--       WHERE c.source_url ILIKE '%triathlon%'
--         AND coalesce(e.discipline,'open_water') <> 'multisport_swim_leg';
--
-- 2. Nothing outside this source is caught by the same rule — the filter is
--    the source URL, so confirm it does not sweep up a genuine open-water
--    event that merely happens to be listed on a triathlon page:
--      SELECT DISTINCT c.source_url FROM event_editions e
--        JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--       WHERE c.source_url ILIKE '%triathlon%';
--      -- expect only the two combinaison-neoprene calendrier-triathlon URLs
--
-- 3. Counts before (for the VERIFY comparison):
--      SELECT count(*) FROM event_editions WHERE is_searchable
--        AND status NOT IN ('cancelled','completed') AND start_date >= current_date
--        AND coalesce(discipline,'open_water') <> 'multisport_swim_leg';   -- 259

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs published rows.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260805c_event_editions_discipline AS
  SELECT id, title, discipline, now() AS backed_up_at FROM event_editions;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE event_editions e
   SET discipline = 'multisport_swim_leg'
  FROM discovery_candidate_events c
 WHERE c.id = e.source_candidate_id
   AND c.source_url ILIKE '%calendrier-triathlon%'
   AND coalesce(e.discipline,'open_water') <> 'multisport_swim_leg';

-- Also correct the candidates, so a future re-crawl or a reviewer sees the
-- same answer the published row does. Without this the two disagree, and
-- the next promotion would reintroduce the wrong value.
UPDATE discovery_candidate_events c
   SET discipline = 'multisport_swim_leg'
 WHERE c.source_url ILIKE '%calendrier-triathlon%'
   AND coalesce(c.discipline,'open_water') <> 'multisport_swim_leg';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo.
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE event_editions e SET discipline = b.discipline
--   FROM _bak_20260805c_event_editions_discipline b WHERE e.id = b.id;
-- COMMIT;
-- (The candidate-side update is not restored: 'multisport_swim_leg' is the
--  correct value for those rows regardless, and reverting it would only
--  re-create the disagreement this migration removes.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. No triathlon-sourced edition is still open water (expect 0):
--      SELECT count(*) FROM event_editions e
--        JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--       WHERE c.source_url ILIKE '%calendrier-triathlon%'
--         AND coalesce(e.discipline,'open_water') <> 'multisport_swim_leg';
--
-- 2. The open-water count drops back by 9 (259 -> 250):
--      SELECT count(*) FROM event_editions WHERE is_searchable
--        AND status NOT IN ('cancelled','completed') AND start_date >= current_date
--        AND coalesce(discipline,'open_water') <> 'multisport_swim_leg';
--
-- 3. Nothing was deleted — total editions unchanged at 270:
--      SELECT count(*) FROM event_editions;
--
-- 4. They are still reachable with the toggle on, i.e. corrected not hidden:
--      SELECT count(*) FROM search_events_v2(p_include_multisport => true, p_page_size => 60);

-- ----------------------------------------------------------------
-- FOLLOW-UP — the real fix is upstream, in the worker.
-- ----------------------------------------------------------------
-- This migration corrects the data; it does not stop it recurring. The
-- classifier in discovery-worker/src/extract/classify.ts reads page content
-- and event names, so a French long-course triathlon called "VentouxMan"
-- contains no token it recognises. The source URL — /courses/
-- calendrier-triathlon-ironman/ — is an unambiguous signal that is
-- currently unused. Feeding the URL path into the multisport classification
-- would have caught all nine, and needs a test alongside it.
