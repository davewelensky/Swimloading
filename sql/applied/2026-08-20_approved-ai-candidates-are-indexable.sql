-- ================================================================
-- SwimLoading — Migration
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED (expected swimloading / szgkzuswelntnevobnoh)';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-08-20_approved-ai-candidates-are-indexable.sql
-- ================================================================

-- Purpose:
--   Make a human approval at /discovery-review actually grant indexability.
--   It never has.

-- Requested by:
--   Dave — 20 Aug 2026 ("do the 66").

-- The bug:
--   sql/applied/2026-08-05_ai-candidates-require-review.sql states the rule
--   in its own words:
--
--       "They become indexable when a human approves them, not before."
--
--   set_edition_indexable() implements something stricter and different: an
--   edition is refused if its source candidate was extracted by ai_fallback,
--   full stop. Approval is never consulted. candidate_status could be
--   'approved', 'pending' or 'rejected' and the answer was the same — no.
--
--   So every candidate Dave reviewed and approved was published to /explore
--   and permanently barred from having an indexed page. 219 upcoming
--   editions are approved-and-ai_fallback; 0 are indexable. The review queue
--   has been running into a wall since 5 August.

-- The fix:
--   An ai_fallback candidate blocks indexing only while it is UNapproved.
--   'rejected', 'pending' and 'needs_review' all still block — the guarantee
--   that nothing unreviewed reaches Google is unchanged. What changes is
--   that approving something now means something.
--
--   Second half, and the reason this was invisible: is_indexable was only
--   ever recomputed when the EDITION was written. Approving a candidate
--   writes the CANDIDATE, so the edition's flag stayed stale even once the
--   rule was right. A trigger on discovery_candidate_events now touches the
--   promoted edition when candidate_status changes, so an approval takes
--   effect at the moment it is given.

-- Not changed:
--   The column is still derived, never hand-set. growth-hub.html says
--   "change the trigger, never the column" and that stays true.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only, before applying)
-- ----------------------------------------------------------------
--   becomes_indexable ..... 95
--   loses_indexable ....... 0
--   total before/after .... 172 -> 267
--   (full query in VERIFY below)

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260820_edition_indexable AS
  SELECT id, slug, is_indexable, source_candidate_id, now() AS backed_up_at
    FROM public.event_editions;

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.set_edition_indexable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- An explicit hand-edit of the column wins, exactly as before.
  IF TG_OP = 'UPDATE' AND NEW.is_indexable IS DISTINCT FROM OLD.is_indexable THEN
    RETURN NEW;
  END IF;

  NEW.is_indexable := (
        NEW.date_confirmed
    AND NEW.start_date IS NOT NULL
    AND NEW.start_date >= current_date
    AND NEW.status NOT IN ('cancelled','postponed','completed')
    AND NEW.verification_tier IN ('confirmed','listed')
    -- An AI-read candidate blocks indexing only while it is UNAPPROVED.
    -- 'rejected', 'pending' and 'needs_review' still block: nothing a human
    -- has not stood behind reaches Google. Previously ai_fallback blocked
    -- unconditionally, so approving a candidate changed nothing.
    AND NOT EXISTS (
      SELECT 1 FROM discovery_candidate_events c
       WHERE c.id = NEW.source_candidate_id
         AND c.extraction_method = 'ai_fallback'
         AND c.candidate_status IS DISTINCT FROM 'approved')
  );
  RETURN NEW;
END;
$function$;

-- Approving a candidate writes the CANDIDATE, not the edition — so without
-- this the edition's flag stays stale until someone happens to edit it.
CREATE OR REPLACE FUNCTION public.recompute_edition_indexable_on_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.candidate_status IS DISTINCT FROM OLD.candidate_status THEN
    -- A no-op write: set_edition_indexable is BEFORE UPDATE and recomputes
    -- because is_indexable itself is not being changed by this statement.
    UPDATE event_editions
       SET updated_at = COALESCE(updated_at, now())
     WHERE source_candidate_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS zz_recompute_indexable_on_review ON public.discovery_candidate_events;
CREATE TRIGGER zz_recompute_indexable_on_review
  AFTER UPDATE OF candidate_status ON public.discovery_candidate_events
  FOR EACH ROW EXECUTE FUNCTION public.recompute_edition_indexable_on_review();

-- Recompute every existing edition under the corrected rule. This touches
-- updated_at only; set_edition_indexable does the rest, so the backfill and
-- the live path cannot produce different answers.
UPDATE public.event_editions
   SET updated_at = COALESCE(updated_at, now())
 WHERE COALESCE(end_date, start_date) >= current_date;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DROP TRIGGER IF EXISTS zz_recompute_indexable_on_review ON public.discovery_candidate_events;
--   -- restore set_edition_indexable() from git (ai_fallback blocked unconditionally), then:
--   UPDATE event_editions e SET is_indexable = b.is_indexable
--     FROM _bak_20260820_edition_indexable b WHERE b.id = e.id;

-- ----------------------------------------------------------------
-- VERIFY (read-only, after applying)
-- ----------------------------------------------------------------
-- 1. Nothing lost, 95 gained.        expect: gained 95, lost 0
-- SELECT count(*) FILTER (WHERE e.is_indexable AND NOT b.is_indexable) AS gained,
--        count(*) FILTER (WHERE NOT e.is_indexable AND b.is_indexable) AS lost
--   FROM event_editions e JOIN _bak_20260820_edition_indexable b ON b.id = e.id;
--
-- 2. Nothing unapproved leaked in.   expect: 0
-- SELECT count(*) FROM event_editions e
--   JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--  WHERE e.is_indexable AND c.extraction_method='ai_fallback'
--    AND c.candidate_status IS DISTINCT FROM 'approved';
--
-- 3. Approving a candidate now grants it immediately (test, rolled back).
