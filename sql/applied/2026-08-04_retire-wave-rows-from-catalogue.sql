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
-- Migration: 2026-08-04_retire-wave-rows-from-catalogue.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Remove start-wave rows that reached the public catalogue as if they
--   were swims you could enter.
--
--   Dave found this on the live page: /explore was showing
--   "Disabled, Pope-Ellis and 71yr/over — 13 Feb, Howick, South Africa —
--   Enter this swim", linking to a generic information page. That is a
--   disability START CATEGORY within the aQuellé Midmar Mile, not an
--   event. The AI extractor read Midmar's wave schedule as a list of
--   events; 26 candidates came out of that source, most of them junk, and
--   five were auto-approved into event_editions.
--
--   The cause is fixed in 359697f — the prompt now states that a wave
--   belongs to its race, and rejectAsEventName() enforces it in code
--   before a candidate exists. This migration clears what already shipped.
--
--   Marked 'cancelled' rather than deleted. The candidate rows stay too.
--   Deleting would destroy the evidence of how they got published, and
--   this is precisely the failure worth being able to reconstruct later —
--   the review queue and the auto-publish rule both waved these through.
--   'cancelled' is enough: search_event_editions filters it out, so they
--   leave the public page immediately.

-- Requested by:
--   Dave — 2026-08-04, "puzzled on this on the screen: Disabled,
--   Pope-Ellis and 71yr/over ... when I clicked to enter the swim, it took
--   me here: midmarmile.com/pages/aquelle-midmar-mile-event-information".

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   -- Exactly what will be retired — READ THIS LIST before applying:
--   SELECT id, title, start_date, verification_tier FROM event_editions
--    WHERE status NOT IN ('cancelled','completed')
--      AND (title ~* '^(?:event|race|wave|heat|group|start|leg)\s*[-–—:.]?\s*[0-9]*$'
--        OR title ~* '(?:race\s*/\s*entry|entry|event)\s+information'
--        OR title ~* '[0-9]+\s*(?:yr|years?)\s+to\s+[0-9]+\s*(?:yr|years?)'
--        OR title ~* '[0-9]+\s*(?:yr|years?).*(?:and\s+)?(?:over|older|under)'
--        OR title ~* 'yrs?\s*/\s*over'
--        OR title ~* 'years?\s+and\s+(?:older|under)'
--        OR title ~* '^(?:non[-\s]?)?(?:company|corporate|club|school|social)\s+teams?$')
--    ORDER BY title;
--   -- expect the Midmar start waves: "Disabled, Pope-Ellis and 71yr/over",
--   -- "Event 1" x2, "Event 3" x2, and any Company/Non-Company Teams rows.
--   -- Dave confirmed from the review queue that these are ALL Midmar waves
--   -- except "Havkraft – Årøsund til Assens", which is a real Danish swim
--   -- and MUST NOT appear in this list.
--
--   -- Confirm no genuine swim is caught by the same patterns. Any name
--   -- here that looks like a real race means STOP and narrow the pattern:
--   -- the cost of a false positive is deleting a real swim from the site.
--
--   SELECT count(*) FROM event_editions
--    WHERE status NOT IN ('cancelled','completed') AND start_date >= current_date;
--   -- note it; should drop by exactly the number retired

-- ----------------------------------------------------------------
-- BACKUP — destructive to what the public sees, so a full row copy.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260804h_wave_editions AS
  SELECT *, now() AS backed_up_at FROM event_editions WHERE false;

BEGIN;

INSERT INTO _bak_20260804h_wave_editions
SELECT e.*, now()
  FROM event_editions e
 WHERE e.status NOT IN ('cancelled','completed')
   AND (e.title ~* '^(?:event|race|wave|heat|group|start|leg)\s*[-–—:.]?\s*[0-9]*$'
     OR e.title ~* '(?:race\s*/\s*entry|entry|event)\s+information'
     OR e.title ~* '[0-9]+\s*(?:yr|years?)\s+to\s+[0-9]+\s*(?:yr|years?)'
     OR e.title ~* '[0-9]+\s*(?:yr|years?).*(?:and\s+)?(?:over|older|under)'
     OR e.title ~* 'yrs?\s*/\s*over'
     OR e.title ~* 'years?\s+and\s+(?:older|under)'
     OR e.title ~* '^(?:non[-\s]?)?(?:company|corporate|club|school|social)\s+teams?$');

-- Same predicate, deliberately repeated rather than driven off the backup
-- table: if the INSERT above matched nothing, this must match nothing too.
UPDATE event_editions e
   SET status = 'cancelled'
 WHERE e.status NOT IN ('cancelled','completed')
   AND (e.title ~* '^(?:event|race|wave|heat|group|start|leg)\s*[-–—:.]?\s*[0-9]*$'
     OR e.title ~* '(?:race\s*/\s*entry|entry|event)\s+information'
     OR e.title ~* '[0-9]+\s*(?:yr|years?)\s+to\s+[0-9]+\s*(?:yr|years?)'
     OR e.title ~* '[0-9]+\s*(?:yr|years?).*(?:and\s+)?(?:over|older|under)'
     OR e.title ~* 'yrs?\s*/\s*over'
     OR e.title ~* 'years?\s+and\s+(?:older|under)'
     OR e.title ~* '^(?:non[-\s]?)?(?:company|corporate|club|school|social)\s+teams?$');

-- Reject the candidates behind them, so auto-publish cannot resurrect the
-- same rows on the next pass. Kept, not deleted: the evidence of how a
-- start category reached the public page is worth more than the tidiness.
-- promoted_edition_id must be cleared in the SAME statement. The schema
-- enforces `promoted_edition_id IS NULL OR candidate_status = 'approved'`
-- (dce_promoted_only_when_approved), so rejecting a promoted candidate
-- without clearing the link violates it — the first apply attempt failed
-- on exactly this and rolled back. The constraint is right: it stops a
-- rejected candidate pointing at a live edition. The link it protects is
-- preserved in the backup above, which carries source_candidate_id.
UPDATE discovery_candidate_events c
   SET candidate_status = 'rejected',
       promoted_edition_id = NULL
 WHERE c.candidate_status <> 'rejected'
   AND (c.canonical_name ~* '^(?:event|race|wave|heat|group|start|leg)\s*[-–—:.]?\s*[0-9]*$'
     OR c.canonical_name ~* '(?:race\s*/\s*entry|entry|event)\s+information'
     OR c.canonical_name ~* '[0-9]+\s*(?:yr|years?)\s+to\s+[0-9]+\s*(?:yr|years?)'
     OR c.canonical_name ~* '[0-9]+\s*(?:yr|years?).*(?:and\s+)?(?:over|older|under)'
     OR c.canonical_name ~* 'yrs?\s*/\s*over'
     OR c.canonical_name ~* 'years?\s+and\s+(?:older|under)'
     OR c.canonical_name ~* '^(?:non[-\s]?)?(?:company|corporate|club|school|social)\s+teams?$');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE event_editions e SET status = b.status
--   FROM _bak_20260804h_wave_editions b WHERE b.id = e.id;
-- COMMIT;
-- (The candidate_status change is not restored — those candidates SHOULD
--  stay rejected regardless; the worker will not re-create them now that
--  rejectAsEventName drops them at build time.)

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- Gone from the public page:
-- SELECT count(*) FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',1000)
--  WHERE title ~* 'yr/over|Event [0-9]+$|RACE/ENTRY';   -- expect 0
--
-- And the specific one Dave saw:
-- SELECT count(*) FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',1000)
--  WHERE title ILIKE '%Pope-Ellis%';                    -- expect 0
--
-- The real Midmar Mile is still there — this must remove the waves, not
-- the race they belong to:
-- SELECT title, start_date FROM search_event_editions(NULL,NULL,NULL,CURRENT_DATE,NULL,false,NULL,NULL,'date',1000)
--  WHERE title ILIKE '%midmar%';                        -- expect the Mile itself
--
-- Backed up before the change, so the count is recoverable:
-- SELECT count(*) FROM _bak_20260804h_wave_editions;    -- expect 5
