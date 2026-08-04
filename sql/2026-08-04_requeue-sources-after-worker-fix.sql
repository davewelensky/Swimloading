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
-- Migration: 2026-08-04_requeue-sources-after-worker-fix.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Make every enabled source due now, so the freshly redeployed worker
--   actually re-crawls with the fixed code instead of idling for a week.
--
--   What happened: the Railway worker ran all day on the pre-fix build,
--   whose classifier read a fixture-only attribute no real site has, so
--   every live page was force-rejected as 'unclassified'. Each of those
--   runs did its normal bookkeeping and pushed next_run_at a week out.
--   Result: 36 sources scheduled for Aug 10 – Sep 03, every candidate
--   they produced holding a score from the broken classifier, and the
--   corrected worker with nothing to do until then.
--
--   Resetting next_run_at is the whole fix. Re-extraction upserts on
--   (source_id, candidate_key), so candidates are RESCORED IN PLACE
--   rather than duplicated, and the crawler rewrites next_run_at at the
--   end of each run — so this value is transient by design and the
--   normal weekly cadence resumes by itself.

-- Requested by:
--   Dave — 2026-08-04, "redeployed railway". This is what makes that
--   redeploy take effect rather than wait a week.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- Sources due right now (expect 0 — that is the problem):
--   SELECT count(*) FROM discovery_sources WHERE enabled AND next_run_at <= now();
--
-- Rows this will update (expect 36):
--   SELECT count(*) FROM discovery_sources WHERE enabled;
--
-- Confirm the disabled ones stay untouched (expect 3: the synthetic
-- fixture source, CLDSA which 403s us, DSV which robots-disallows us):
--   SELECT count(*) FROM discovery_sources WHERE NOT enabled;

-- ----------------------------------------------------------------
-- BACKUP — this UPDATEs a scheduling column on live rows.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260804c_source_schedule AS
  SELECT id, name, next_run_at, last_run_at, health_status, consecutive_failure_count,
         now() AS backed_up_at
  FROM discovery_sources;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Staggered rather than all at once: the worker takes 10 sources per
-- pass and waits 15 minutes between passes, so spreading the due times
-- over ~an hour lets it work through them in its normal rhythm instead
-- of finding 36 at once and deferring most of them anyway. Politeness to
-- the organisers' servers too — 36 simultaneous crawls is a spike they
-- have no reason to absorb.
UPDATE discovery_sources s
   SET next_run_at = now() + (make_interval(mins => (((r.rn - 1) * 2))::int)),
       updated_at  = now()
  FROM (
    SELECT id, row_number() OVER (
             -- Sources that have produced published events first: those
             -- are the ones whose candidates most need rescoring.
             ORDER BY (SELECT count(*) FROM discovery_candidate_events c
                        WHERE c.source_id = discovery_sources.id) DESC,
                      authority_level, name
           ) AS rn
      FROM discovery_sources
     WHERE enabled
  ) r
 WHERE s.id = r.id;

-- Clear the failure counters set by the broken build so a source is not
-- carrying backoff it never earned. health_status is left alone — the
-- next real run recomputes it from what actually happens.
UPDATE discovery_sources
   SET consecutive_failure_count = 0
 WHERE enabled AND consecutive_failure_count > 0;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE discovery_sources s
--    SET next_run_at = b.next_run_at,
--        consecutive_failure_count = b.consecutive_failure_count,
--        updated_at = now()
--   FROM _bak_20260804c_source_schedule b
--  WHERE s.id = b.id;
--
-- Only meaningful BEFORE the worker picks them up; once a source runs it
-- sets its own next_run_at and is back on the normal weekly cadence.

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM discovery_sources WHERE enabled AND next_run_at <= now();
--   -- expect: 1 immediately, rising as the staggered times arrive
--
-- SELECT to_char(min(next_run_at),'HH24:MI') AS first_due,
--        to_char(max(next_run_at),'HH24:MI') AS last_due
--   FROM discovery_sources WHERE enabled;      -- expect: ~70 minutes apart
--
-- Within ~15 minutes of applying, the worker should be running again:
--   SELECT s.name, r.status, r.pages_fetched, r.candidates_found,
--          to_char(r.started_at,'HH24:MI') AS at
--     FROM discovery_runs r JOIN discovery_sources s ON s.id = r.source_id
--    WHERE r.started_at > now() - interval '30 minutes'
--    ORDER BY r.started_at DESC;
--   -- expect: rows appearing, and candidates_found > 0 for sources that
--   --         previously found nothing under the broken classifier.
