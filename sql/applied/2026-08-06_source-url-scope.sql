-- ================================================================
-- SwimLoading — Migration (schema + data; MIGRATIONS.md applies)
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-06_source-url-scope.sql
-- ================================================================

-- Purpose:
--   Give a source a way to say which URLs it may expand into.
--
--   Lopplistan is configured correctly — base_url is
--   https://lopplistan.se/sverige/simning/alla-/, the swim listing. The
--   crawler still published two running races, because it followed
--   same-site links out of that page into https://lopplistan.se/ and
--   https://lopplistan.se/sverige/alla/alla-/, the ALL-SPORTS listings.
--   140 of its 170 candidates came from those two pages, and all three of
--   its published events did.
--
--   Link discovery has no notion of a source's scope: any same-site link,
--   and any sitemap URL, is a candidate page. That is right for a
--   single-sport organiser and wrong for a multi-sport calendar, where the
--   nav bar leads to running, cycling, skiing and OCR listings.
--
--   expand_url_pattern is a POSIX regex a DISCOVERED url must match before
--   it is queued. NULL means no constraint, which is every existing source
--   and today's exact behaviour — so this is inert until a source opts in.
--   base_url itself is always crawled and is never filtered: the pattern
--   scopes discovery, it does not gate the page you configured.

-- Requested by:
--   Dave, 2026-08-06.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------

-- 1. The column must not already exist. Expect 0.
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_name='discovery_sources' AND column_name='expand_url_pattern';

-- 2. The pattern below must match the pages we WANT and reject the ones we
--    do not. Verified read-only against the URLs already in the table:
-- SELECT DISTINCT c.source_url,
--        c.source_url ~ '^https://lopplistan\.se/(sverige/simning/|lopp/)' AS would_keep
--   FROM discovery_candidate_events c
--   JOIN discovery_sources s ON s.id = c.source_id
--  WHERE s.name ILIKE '%Lopplistan%';
--    expected: /sverige/simning/alla-/ and /lopp/... keep;
--              /sverige/alla/alla-/ and the bare homepage reject.

-- 3. Nothing else is affected — every other source keeps a NULL pattern.
-- SELECT count(*) FROM discovery_sources WHERE expand_url_pattern IS NOT NULL;
--    expected 1 after applying, 0 before.

-- ----------------------------------------------------------------
-- BACKUP — not required: this adds a nullable column and sets it on one
-- row. The prior value of that row is NULL by definition of the ALTER.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE public.discovery_sources
  ADD COLUMN IF NOT EXISTS expand_url_pattern text;

COMMENT ON COLUMN public.discovery_sources.expand_url_pattern IS
  'POSIX regex a DISCOVERED url must match before the crawler queues it. '
  'NULL = no constraint (the default, and every source''s behaviour before '
  '2026-08-06). base_url is always crawled and never filtered by this. '
  'Set it on multi-sport calendars whose nav leads to other sports: '
  'Lopplistan published two running races this way.';

-- Lopplistan: its own swim listing, plus the per-event detail pages under
-- /lopp/ that a swim row links to. Everything else on the site — /sverige/
-- lopning/, /sverige/cykel-mtb/, /sverige/alla/, the homepage — is another
-- sport's calendar and is now out of scope.
UPDATE public.discovery_sources
   SET expand_url_pattern = '^https://lopplistan\.se/(sverige/simning/|lopp/)'
 WHERE id = '00000000-0000-4000-8000-000000000036';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE public.discovery_sources SET expand_url_pattern = NULL
--  WHERE id = '00000000-0000-4000-8000-000000000036';
-- ALTER TABLE public.discovery_sources DROP COLUMN IF EXISTS expand_url_pattern;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------

-- 1. Exactly one source is scoped, and it is Lopplistan.
-- SELECT name, expand_url_pattern FROM discovery_sources
--  WHERE expand_url_pattern IS NOT NULL;

-- 2. The pattern keeps the swim pages and rejects the rest.
-- SELECT DISTINCT c.source_url,
--        c.source_url ~ s.expand_url_pattern AS would_keep
--   FROM discovery_candidate_events c
--   JOIN discovery_sources s ON s.id = c.source_id
--  WHERE s.expand_url_pattern IS NOT NULL;

-- 3. No other source changed behaviour.
-- SELECT count(*) FROM discovery_sources WHERE expand_url_pattern IS NULL;
--    expected: all the rest
