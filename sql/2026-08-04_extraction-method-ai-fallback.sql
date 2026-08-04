-- ================================================================
-- SwimLoading — Migration Template
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-04_extraction-method-ai-fallback.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Let a candidate record that a language model read it off an
--   unstructured page.
--
--   discovery_candidate_events.extraction_method currently permits
--   ('jsonld','html','jsonld+html','none'). The worker's new AI fallback
--   writes 'ai_fallback', and without this the INSERT fails outright — so
--   this migration must land BEFORE DISCOVERY_AI_ENABLED is switched on.
--
--   Note the asymmetry being corrected: discovery_event_evidence.
--   evidence_type has permitted 'ai_fallback' since discovery-schema-v1.
--   The evidence column was designed for this; the candidate column was
--   overlooked. This makes the pair consistent.
--
--   Why a distinct value rather than reusing 'html': because the whole
--   safety argument for AI extraction rests on a reviewer being able to
--   ask "which of these did a model give us?" and get a complete answer
--   in one WHERE clause. Folding AI-read candidates into 'html' would
--   make that question unanswerable in SQL — and the answer matters most
--   at exactly the moment something has gone wrong.
--
--   Nothing about publication changes here. AI-read candidates go through
--   the same auto_publish_eligible_candidates path, the same deterministic
--   confidence arithmetic and the same verification tiers as every other
--   candidate. This migration only widens a CHECK.

-- Requested by:
--   Dave — 2026-08-04, "yes build AI extraction - do we have any idea of
--   costs ?", after 32 of the 36 sources seeded that day fetched cleanly
--   (HTTP 200) and produced zero candidates because their calendars are
--   plain HTML with no JSON-LD and no <table>.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   -- The current constraint, so the rollback below is provably correct:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'discovery_candidate_events'::regclass
--      AND conname LIKE '%extraction_method%';
--   -- expect: CHECK ((extraction_method = ANY (ARRAY['jsonld','html','jsonld+html','none'])))
--
--   -- No existing row can violate the WIDER constraint, but confirm the
--   -- current distribution so the verify step below has a baseline:
--   SELECT extraction_method, count(*) FROM discovery_candidate_events GROUP BY 1 ORDER BY 2 DESC;
--   -- expect: html (~338), jsonld+html / jsonld / none (small counts), NO ai_fallback
--
--   -- Evidence side already allows it — this is the asymmetry being fixed:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'discovery_event_evidence'::regclass
--      AND conname LIKE '%evidence_type%';
--   -- expect: ... 'playwright','ai_fallback' ...

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- Not required. This migration widens a CHECK constraint and writes no
-- rows: every existing value remains valid, and no data is read, changed
-- or deleted. The rollback below restores the exact prior constraint.

BEGIN;

-- Drop-and-recreate rather than ALTER: Postgres has no "widen a CHECK" in
-- place, and naming the constraint explicitly means the rollback restores
-- an identically-named one rather than leaving a system-generated name.
ALTER TABLE public.discovery_candidate_events
  DROP CONSTRAINT IF EXISTS discovery_candidate_events_extraction_method_check;

ALTER TABLE public.discovery_candidate_events
  ADD CONSTRAINT discovery_candidate_events_extraction_method_check
  CHECK (extraction_method IN ('jsonld', 'html', 'jsonld+html', 'ai_fallback', 'none'));

COMMENT ON COLUMN public.discovery_candidate_events.extraction_method IS
  'How the candidate''s raw facts were read off the page. '
  '''ai_fallback'' means a language model transcribed an unstructured page '
  'into columns because JSON-LD, table and selector extraction all found '
  'nothing — everything after that reading (dates, locations, distances, '
  'classification, confidence) is the same deterministic code as for any '
  'other method. Query on this value to review everything a model touched.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- Only safe while no ai_fallback rows exist. If AI extraction has already
-- run, the DELETE below removes those candidates first — which is the
-- correct behaviour for a rollback of this feature, but is destructive, so
-- check the count before running it:
--   SELECT count(*) FROM discovery_candidate_events WHERE extraction_method='ai_fallback';
--
-- BEGIN;
-- DELETE FROM discovery_candidate_events WHERE extraction_method = 'ai_fallback';
-- ALTER TABLE public.discovery_candidate_events
--   DROP CONSTRAINT IF EXISTS discovery_candidate_events_extraction_method_check;
-- ALTER TABLE public.discovery_candidate_events
--   ADD CONSTRAINT discovery_candidate_events_extraction_method_check
--   CHECK (extraction_method IN ('jsonld','html','jsonld+html','none'));
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- The constraint now permits the new value:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'discovery_candidate_events'::regclass
--    AND conname = 'discovery_candidate_events_extraction_method_check';
-- -- expect the array to contain 'ai_fallback'
--
-- Nothing was written — the distribution is unchanged from the pre-check:
-- SELECT extraction_method, count(*) FROM discovery_candidate_events GROUP BY 1 ORDER BY 2 DESC;
--
-- Junk is still rejected (run inside a transaction and ROLL BACK):
-- BEGIN;
--   UPDATE discovery_candidate_events SET extraction_method='psychic'
--    WHERE id = (SELECT id FROM discovery_candidate_events LIMIT 1);  -- expect: violates check constraint
-- ROLLBACK;
--
-- After the first AI-enabled crawl, this is the reviewer's one-line answer
-- to "what did a model give us?":
-- SELECT source_id, count(*), min(confidence_score), max(confidence_score)
--   FROM discovery_candidate_events WHERE extraction_method='ai_fallback' GROUP BY 1;
