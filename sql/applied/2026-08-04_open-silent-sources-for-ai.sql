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
-- Migration: 2026-08-04_open-silent-sources-for-ai.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Bring forward the next crawl of every enabled source that has never
--   produced a candidate, so AI extraction reaches them now rather than
--   when their weekly schedule next comes round.
--
--   26 of 37 enabled sources still hold zero candidates. They fetch fine
--   — HTTP 200, real content — but their calendars are plain HTML with no
--   JSON-LD and no <table>, which nothing deterministic can read. That is
--   exactly what AI extraction was built for, and it is now proven: the
--   French federation calendar went from 0 candidates to 36 real swims
--   with verified dates, full distance lists and correct venues.
--
--   Deliberately NOT touched: the 11 sources already producing candidates.
--   They work, they are on a weekly schedule, and forcing them early buys
--   nothing while spending AI calls on their gate-failed pages.
--
--   ⚠️ COST. DISCOVERY_MAX_AI_CALLS_PER_RUN is enforced PER SOURCE PER
--   RUN, not globally. 26 sources at the suggested cap of 25 is up to 650
--   calls in one sweep. Measured cost is ~$0.087/page on claude-sonnet-5
--   at introductory pricing, so that ceiling is roughly $57 — well above
--   the $13-22 quoted before the first real measurement.
--
--   Set DISCOVERY_MAX_AI_CALLS_PER_RUN=5 before applying this. 26 x 5 =
--   130 calls, about $11, and the scheduler keeps working through each
--   source's remaining pages on subsequent runs. Raise the cap once
--   discovery_runs.metrics shows what the sources actually spend. A cap
--   is only a safety net if it is set below what you can afford to lose.

-- Requested by:
--   Dave — 2026-08-04, "switch to sonnet and open all 32 sources", after
--   reviewing the 36 French events the first AI run produced.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   -- How many sources this will touch, and confirmation they are the
--   -- silent ones rather than the working ones:
--   SELECT count(*) FILTER (WHERE n = 0) AS silent, count(*) FILTER (WHERE n > 0) AS producing
--     FROM (SELECT s.id, (SELECT count(*) FROM discovery_candidate_events e WHERE e.source_id=s.id) AS n
--             FROM discovery_sources s WHERE s.enabled) t;
--   -- expect: 26 silent, 11 producing
--
--   -- The worker must already be on 6ecfab7 or later. Before that commit
--   -- every venue name came back mangled ("Lieu : ANNECYVille : ANNECY"),
--   -- and a sweep on the old build would write 26 sources' worth of it:
--   SELECT count(*) FROM discovery_candidate_events
--    WHERE extraction_method='ai_fallback' AND venue_name LIKE '%Lieu :%';
--   -- if this is > 0 the running build is stale — redeploy before applying
--
--   -- Confirm the AI budget is set to something survivable:
--   -- (checked in Railway, not SQL) DISCOVERY_MAX_AI_CALLS_PER_RUN should
--   -- be 5 for this first sweep, not 25.

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260804f_source_schedule AS
  SELECT id, name, next_run_at, health_status, consecutive_failure_count, now() AS backed_up_at
  FROM discovery_sources;

BEGIN;

-- Staggered, not simultaneous. The scheduler takes maxSourcesPerPass (10)
-- per wake and wakes every 15 minutes, so a flat now() would simply queue
-- them anyway — but spacing them by 12 minutes makes the sweep legible in
-- discovery_runs and leaves an obvious window to stop it partway if the
-- first few sources spend more than expected.
WITH silent AS (
  SELECT s.id, row_number() OVER (ORDER BY s.name) AS rn
    FROM discovery_sources s
   WHERE s.enabled
     AND NOT EXISTS (SELECT 1 FROM discovery_candidate_events e WHERE e.source_id = s.id)
)
UPDATE discovery_sources s
   SET next_run_at = now() + (silent.rn * interval '12 minutes')
  FROM silent
 WHERE s.id = silent.id;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- Stops the sweep for any source that has not yet run.
-- BEGIN;
-- UPDATE discovery_sources s SET next_run_at = b.next_run_at
--   FROM _bak_20260804f_source_schedule b WHERE b.id = s.id;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- SELECT count(*) AS rescheduled FROM discovery_sources s
--   JOIN _bak_20260804f_source_schedule b ON b.id = s.id
--  WHERE s.next_run_at IS DISTINCT FROM b.next_run_at;   -- expect 26
--
-- SELECT name, next_run_at FROM discovery_sources
--  WHERE enabled ORDER BY next_run_at LIMIT 30;
--
-- WATCH THE SPEND as the sweep runs — this is the number that matters:
-- SELECT s.name, r.started_at, r.status, r.candidates_found,
--        r.metrics->>'aiCallsMade'    AS calls,
--        r.metrics->>'aiCandidates'   AS ai_cands,
--        r.metrics->>'aiInputTokens'  AS in_tok,
--        r.metrics->>'aiOutputTokens' AS out_tok
--   FROM discovery_runs r JOIN discovery_sources s ON s.id = r.source_id
--  WHERE (r.metrics->>'aiCallsMade')::int > 0
--  ORDER BY r.started_at DESC;
--
-- Running total for the sweep (multiply by the model's published rate):
-- SELECT sum((metrics->>'aiCallsMade')::int)     AS calls,
--        sum((metrics->>'aiInputTokens')::int)   AS in_tokens,
--        sum((metrics->>'aiOutputTokens')::int)  AS out_tokens
--   FROM discovery_runs WHERE started_at > '2026-08-04' AND metrics ? 'aiCallsMade';
--
-- Quality spot-check once candidates land — venue names must NOT contain
-- field labels, which would mean the worker is on a pre-6ecfab7 build:
-- SELECT canonical_name, start_date, date_confirmed, venue_name, city, country_code, confidence_score
--   FROM discovery_candidate_events WHERE extraction_method='ai_fallback'
--  ORDER BY extracted_at DESC LIMIT 20;
