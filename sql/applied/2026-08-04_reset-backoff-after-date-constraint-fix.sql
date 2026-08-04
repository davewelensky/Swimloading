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
-- Migration: 2026-08-04_reset-backoff-after-date-constraint-fix.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Un-bench two sources that the scheduler backed off because of a
--   worker bug, not because of anything wrong with the sources.
--
--   On the first AI-enabled crawl, Vansbrosimningen wrote 16 good
--   candidates and then threw:
--
--     persistCandidate(...) violates check constraint
--     "dce_unconfirmed_has_no_dates"
--
--   parseYearlessDate returned a date with date_confirmed=false, which the
--   schema forbids (`date_confirmed OR (start_date IS NULL AND end_date IS
--   NULL)`). crawlSource's catch path correctly recorded a failure — and
--   the exponential backoff correctly pushed next_run_at out to 3 OCTOBER,
--   two months away. Both behaved as designed; the input was a bug.
--
--   Fixed in commit 82fd6a4 (parser no longer emits unverified dates, plus
--   a row-builder backstop so no future extractor can abort a crawl this
--   way). With the cause gone, the punishment should go too — otherwise a
--   Swedish source that demonstrably works sits idle until October.
--
--   Open Water Swimming Association India is included for a different
--   reason worth stating plainly: it fetched 0 pages and is genuinely
--   'blocked'. Its backoff may well be deserved. It is reset ONCE so the
--   next run produces fresh evidence either way — if it fails again the
--   backoff simply reapplies, and we will know it is the site rather than
--   a coincidence of timing with today's deploy.
--
--   Deliberately NOT reset: the three 'degraded' sources. Nothing crashed
--   on those; degraded reflects real partial-fetch results, and clearing
--   it would be discarding a true signal.

-- Requested by:
--   Follow-up to the 2026-08-04 AI-extraction launch. Data change, so it
--   goes through the migration process rather than a raw execute_sql —
--   see MIGRATIONS.md.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   SELECT name, health_status, consecutive_failure_count, next_run_at, last_run_at
--     FROM discovery_sources
--    WHERE name LIKE 'Vansbro%' OR name LIKE 'Open Water Swimming Association India%';
--   -- expect: both with consecutive_failure_count = 1 and next_run_at in October 2026
--
--   -- Confirm the crash is the one this is compensating for:
--   SELECT s.name, r.status, r.candidates_found, left(r.error_message, 80)
--     FROM discovery_runs r JOIN discovery_sources s ON s.id = r.source_id
--    WHERE r.error_message LIKE '%dce_unconfirmed_has_no_dates%';
--   -- expect: 1 row, Vansbrosimningen, partial, 16 candidates
--
--   -- Nothing else was hit by it:
--   SELECT count(*) FROM discovery_runs WHERE error_message LIKE '%dce_unconfirmed%';  -- expect 1

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260804e_source_backoff AS
  SELECT id, name, health_status, consecutive_failure_count, next_run_at, last_run_at, now() AS backed_up_at
  FROM discovery_sources;

BEGIN;

-- Due in five minutes, not immediately: the worker must be redeployed on
-- 82fd6a4 first, and a source that runs against the old build simply
-- reproduces the crash and re-earns its backoff.
UPDATE discovery_sources
   SET consecutive_failure_count = 0,
       health_status = 'healthy',
       next_run_at = now() + interval '5 minutes'
 WHERE enabled = true
   AND consecutive_failure_count > 0
   AND (name LIKE 'Vansbro%' OR name LIKE 'Open Water Swimming Association India%');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE discovery_sources s
--    SET consecutive_failure_count = b.consecutive_failure_count,
--        health_status             = b.health_status,
--        next_run_at               = b.next_run_at
--   FROM _bak_20260804e_source_backoff b
--  WHERE b.id = s.id
--    AND (s.name LIKE 'Vansbro%' OR s.name LIKE 'Open Water Swimming Association India%');
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- SELECT name, health_status, consecutive_failure_count, next_run_at
--   FROM discovery_sources
--  WHERE name LIKE 'Vansbro%' OR name LIKE 'Open Water Swimming Association India%';
-- -- expect: both healthy, 0 failures, next_run_at ~5 minutes from now
--
-- Exactly two rows changed, and no other source was touched:
-- SELECT count(*) FROM discovery_sources s JOIN _bak_20260804e_source_backoff b ON b.id = s.id
--  WHERE s.next_run_at IS DISTINCT FROM b.next_run_at;   -- expect 2
--
-- After the next run, the AI telemetry that the crash destroyed should
-- finally be recorded — this is the real cost figure:
-- SELECT s.name, r.status,
--        r.metrics->>'aiCallsMade' AS calls,
--        r.metrics->>'aiInputTokens' AS in_tokens,
--        r.metrics->>'aiOutputTokens' AS out_tokens
--   FROM discovery_runs r JOIN discovery_sources s ON s.id = r.source_id
--  WHERE r.metrics ? 'aiCallsMade' AND (r.metrics->>'aiCallsMade')::int > 0
--  ORDER BY r.started_at DESC;
