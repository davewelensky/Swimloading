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
-- Migration: 2026-08-06_force-reextract-france.sql
-- ================================================================

-- Purpose:
--   Force a genuine re-extraction of Combinaison-Néoprène, whose 187
--   dateless candidates are the single largest block in the review queue.
--
--   They are NOT a parser gap. Every one carries the OLD worker build's
--   warning — "the page gives no weekday to verify the year against 2026"
--   — and the fixed parser reads those same rows correctly today:
--   parseYearlessDate('7 juin', 2026) returns 2026-06-07, confirmed. They
--   were extracted on 5 August by the build that was already superseded,
--   during the window when Railway was serving a stale image. Of the 615
--   dateless candidates, 305 carry that fingerprint and ZERO carry the
--   fixed build's.
--
--   WHY next_run_at ALONE IS NOT ENOUGH, which is the mistake this file
--   exists to avoid. 2026-08-05_force-recrawl-dateless-sources.sql bumped
--   next_run_at for 16 sources and was applied — and the dateless count
--   did not move, because the worker was running old code. Bumping it
--   again would re-run the same page against the same guard:
--
--     crawl-source.ts:245
--       if (!changed && aiExtractedKeys.has(urlKey(url))) return 0;
--
--   The French calendar page has no table and no JSON-LD — a dry run on
--   2026-08-06 showed it skipped by the deterministic gate as "not an
--   event page" — so only the AI path can read it, and the AI path skips a
--   page that is both already-read and UNCHANGED. Whether it re-reads
--   would come down to whether the page happened to edit itself since
--   Wednesday. That is not a plan.
--
--   Clearing content_hash makes `changed` true by construction, because
--   recordPageFetch computes it as
--     record.contentHash IS NOT NULL AND record.contentHash <> existing.content_hash
--   and a NULL stored hash can never equal a freshly computed one. This is
--   the actual force lever the 2026-08-05 handoff asked for.
--
--   COST. 58 pages, and the AI budget is per-run, so this re-reads the
--   listing and up to the run's cap. Scoped to ONE source deliberately:
--   the other 4 sources holding stale-fingerprint candidates (Sweden 73,
--   Mexico 39, and the rest) are left alone until this one proves the
--   approach. France is 187 of the 305 and its page states its year
--   unambiguously in both <title> and <h1>, so it is the clean experiment.

-- Requested by:
--   Dave, 2026-08-06.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------

-- 1. The source and its page count. Expect 58 pages, all with a hash.
-- SELECT s.name, count(*) AS pages, count(*) FILTER (WHERE p.content_hash IS NOT NULL) AS with_hash
--   FROM discovery_source_pages p JOIN discovery_sources s ON s.id = p.source_id
--  WHERE s.id = '00000000-0000-4000-8000-00000000003f' GROUP BY s.name;
--    Result 2026-08-06: 58 pages, 58 with a hash, last fetched 2026-08-05.

-- 2. The candidates this is meant to rescue. Expect 187, all dateless, all
--    carrying the old build's fingerprint.
-- SELECT count(*) FILTER (WHERE start_date IS NULL) AS dateless,
--        count(*) FILTER (WHERE warnings::text LIKE '%no weekday to verify%') AS stale_build
--   FROM discovery_candidate_events
--  WHERE source_id = '00000000-0000-4000-8000-00000000003f'
--    AND candidate_status IN ('pending','needs_review');

-- 3. Only this source is touched. Expect 1.
-- SELECT count(*) FROM discovery_sources WHERE id = '00000000-0000-4000-8000-00000000003f';

-- ----------------------------------------------------------------
-- BACKUP — required: this is an UPDATE.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260806_fr_pages AS
--   SELECT id, source_id, canonical_url, content_hash, page_type, last_fetched_at
--     FROM discovery_source_pages WHERE source_id = '00000000-0000-4000-8000-00000000003f';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Forget what these pages looked like, so the next fetch counts as
--    changed and the AI guard on crawl-source.ts:245 lets them through.
UPDATE discovery_source_pages
   SET content_hash = NULL
 WHERE source_id = '00000000-0000-4000-8000-00000000003f';

-- 2. Make the source due now rather than on 12 August.
UPDATE discovery_sources
   SET next_run_at = now()
 WHERE id = '00000000-0000-4000-8000-00000000003f';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE discovery_source_pages p SET content_hash = b.content_hash
--   FROM _bak_20260806_fr_pages b WHERE b.id = p.id;
-- UPDATE discovery_sources SET next_run_at = '2026-08-12 11:23:44.231+00'
--  WHERE id = '00000000-0000-4000-8000-00000000003f';

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------

-- 1. Hashes cleared, source due. Expect 0 with_hash, next_run_at in the past.
-- SELECT count(*) FILTER (WHERE content_hash IS NOT NULL) AS with_hash
--   FROM discovery_source_pages WHERE source_id = '00000000-0000-4000-8000-00000000003f';
-- SELECT next_run_at <= now() AS due FROM discovery_sources
--  WHERE id = '00000000-0000-4000-8000-00000000003f';

-- 2. AFTER the worker has run — this is the check that actually matters,
--    and it is a check on BEHAVIOUR, not on the deploy log. The stale
--    fingerprint should fall and the fixed one appear:
-- SELECT count(*) FILTER (WHERE warnings::text LIKE '%no weekday to verify%') AS stale,
--        count(*) FILTER (WHERE warnings::text LIKE '%taken from the page%') AS fixed,
--        count(*) FILTER (WHERE start_date IS NOT NULL) AS now_dated
--   FROM discovery_candidate_events
--  WHERE source_id = '00000000-0000-4000-8000-00000000003f';
--    If stale stays 187 and fixed stays 0, the worker is STILL not running
--    the current build — check that before touching the parser again.
