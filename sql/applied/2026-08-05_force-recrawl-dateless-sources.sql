-- ================================================================
-- SwimLoading — Migration (data change; MIGRATIONS.md applies)
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-05_force-recrawl-dateless-sources.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ✅ APPLIED 2026-08-05 07:33 UTC. Verified: 16 sources due,
--            37 still enabled (nothing enabled or disabled as a side
--            effect), consecutive_failure_count and last_run_at untouched.
--            Whether the worker picked them up, and whether the dateless
--            count moved off 567, is recorded in the handoff — the apply
--            itself only made them eligible.
-- ================================================================

-- Purpose:
--   Bring forward the next crawl of the 16 sources holding all 567 dateless
--   queued candidates, so the 2026-08-04 page-stated-year fix is finally
--   exercised against them.
--
--   Why now. The catalogue has been frozen at 250 upcoming swims since
--   4 August 19:34. Two independent reasons, and neither is the AI-review
--   rule applied earlier today (that blocks exactly 2 candidates):
--
--     1. Nothing is due to crawl. All 37 enabled sources ran on 4 August and
--        went onto weekly cadence; the earliest next_run_at is 2026-08-11,
--        149 hours away.
--     2. Even a sweep right now would publish nothing: of 582 queued
--        candidates, 567 have no confirmed date, and an unconfirmed date can
--        never be stored, let alone published.
--
--   The 2026-08-04 handoff predicted those 567 "should resolve themselves
--   now that page-stated years are accepted, as sources re-crawl". That
--   prediction has never been tested, because the re-crawl has not happened.
--   This migration tests it.
--
--   WHY THESE 16 AND NOT ALL 37. These are precisely the sources holding
--   dateless candidates, so they are the experiment; the other 21 have
--   nothing to re-resolve and re-crawling them would spend AI budget to
--   confirm what we already have. Concentration is stark and informative —
--   the top four hold 412 of the 567:
--     Combinaison-Néoprène (FR)  187
--     Lopplistan (SE)             98
--     Swimchannel Brasil (PT-BR)  75
--     NOWW (NL)                   52
--   All non-English. That is consistent with the fix being the right one:
--   these are exactly the calendars where a bare "12 juin" needs the year
--   from the page's own heading.
--
--   COST. 16 sources at DISCOVERY_MAX_AI_CALLS_PER_RUN=5 is at most 80 AI
--   calls. Measured rate is ~135 calls for about $2 on Sonnet, so this is
--   roughly $1. Widening to all 37 later is a one-word change to the WHERE
--   clause below.
--
--   THIS MIGRATION DOES NOT START ANYTHING. It only makes the sources
--   ELIGIBLE. The Railway worker (project heartfelt-benevolence, service
--   Swimloading) must actually be running to pick them up — there is no
--   auto-deploy, and a stale or stopped service will simply leave
--   next_run_at in the past. Confirm the service is up, then watch
--   discovery_runs.

-- Requested by:
--   Dave — 2026-08-05, "yes force the re-crawl", after asking why the page
--   is stuck at 250 swims.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. Nothing is currently due, which is the problem (expect 0):
--      SELECT count(*) FROM discovery_sources
--       WHERE enabled AND (next_run_at IS NULL OR next_run_at <= now());
--
-- 2. The 16 sources this will touch, and their dateless load:
--      SELECT s.name, count(*) FILTER (WHERE NOT c.date_confirmed) AS dateless
--        FROM discovery_candidate_events c JOIN discovery_sources s ON s.id=c.source_id
--       WHERE c.candidate_status IN ('pending','needs_review')
--       GROUP BY s.name HAVING count(*) FILTER (WHERE NOT c.date_confirmed) > 0
--       ORDER BY 2 DESC;
--      -- ACTUAL 2026-08-05: 16 sources, 567 dateless, all enabled.
--
-- 3. Baselines to compare against after the sweep:
--      SELECT count(*) FROM event_editions;                            -- 259
--      SELECT count(*) FROM event_editions WHERE is_searchable
--        AND status NOT IN ('cancelled','completed')
--        AND start_date >= current_date;                               -- 250
--      SELECT count(*) FROM discovery_candidate_events
--       WHERE candidate_status IN ('pending','needs_review');           -- 582
--      SELECT count(*) FROM discovery_candidate_events
--       WHERE candidate_status IN ('pending','needs_review')
--         AND NOT date_confirmed;                                       -- 567

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs scheduling columns on live rows.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260805b_discovery_sources AS
  SELECT id, name, next_run_at, last_run_at, consecutive_failure_count, now() AS backed_up_at
  FROM discovery_sources;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE discovery_sources s
   SET next_run_at = now()
 WHERE s.enabled
   AND EXISTS (
     SELECT 1 FROM discovery_candidate_events c
      WHERE c.source_id = s.id
        AND c.candidate_status IN ('pending','needs_review')
        AND NOT c.date_confirmed);

COMMIT;

-- Deliberately NOT done here:
--   * consecutive_failure_count is left alone. It is a health signal, and
--     zeroing it would hide a source that has been failing.
--   * last_run_at is left alone. It records what actually happened; the
--     worker updates it when it genuinely runs.
--   * No source is enabled or disabled. Scheduling only.

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo.
-- ----------------------------------------------------------------
-- Only meaningful BEFORE the worker picks the sources up. Once a crawl has
-- run, restoring next_run_at would just schedule a redundant future crawl —
-- harmless, but it does not un-crawl anything. Candidates are upserted on
-- (source_id, candidate_key), so a re-crawl UPDATES rows in place rather
-- than duplicating them; there is nothing to clean up either way.
--
-- BEGIN;
-- UPDATE discovery_sources s SET next_run_at = b.next_run_at
--   FROM _bak_20260805b_discovery_sources b WHERE s.id = b.id;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. Exactly 16 sources are now due, and no more:
--      SELECT count(*) FROM discovery_sources
--       WHERE enabled AND next_run_at <= now();          -- expect 16
--
-- 2. Nothing was enabled or disabled as a side effect:
--      SELECT count(*) FROM discovery_sources WHERE enabled;   -- expect 37
--
-- 3. THEN watch the worker. Nothing below is true until Railway actually
--    runs; if these stay flat for an hour, the service is not running and
--    needs a manual Redeploy (there is no auto-deploy):
--      SELECT max(started_at) FROM discovery_runs;
--      SELECT count(*) FROM discovery_runs WHERE started_at > now() - interval '1 hour';
--
-- 4. Did the page-stated-year fix actually rescue the dateless ones? This
--    is the whole question — compare against the 567 baseline:
--      SELECT count(*) FROM discovery_candidate_events
--       WHERE candidate_status IN ('pending','needs_review') AND NOT date_confirmed;
--      -- a meaningful DROP means the fix works and those swims can publish;
--      -- unchanged at 567 means the dates are genuinely not on those pages
--      -- and no amount of re-crawling will help — stop re-running it and
--      -- treat it as a source problem instead.
--
-- 5. Anything newly publishable:
--      SELECT count(*) FROM discovery_candidate_events c
--       WHERE c.candidate_status IN ('pending','needs_review')
--         AND c.publication_recommendation <> 'rejected'
--         AND c.extraction_method <> 'ai_fallback'
--         AND c.date_confirmed AND c.start_date >= current_date;   -- was 0
--
-- 6. AI spend for the sweep, so the ~$1 estimate can be checked rather than
--    trusted:
--      SELECT sum((metrics->>'ai_calls')::int)   AS calls,
--             sum((metrics->>'ai_tokens_in')::int)  AS tok_in,
--             sum((metrics->>'ai_tokens_out')::int) AS tok_out
--        FROM discovery_runs WHERE started_at > now() - interval '6 hours';
