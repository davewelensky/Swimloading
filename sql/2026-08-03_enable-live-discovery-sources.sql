-- ================================================================
-- SwimLoading — Migration Template
-- Copy this header into EVERY new migration file.
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT — MIGRATION ABORTED                       ║\n'
      '║                                                          ║\n'
      '║  This migration is for: SwimLoading                     ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh            ║\n'
      '║                                                          ║\n'
      '║  You are connected to a DIFFERENT Supabase project.     ║\n'
      '║  No changes have been made. Check your browser URL.     ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-03_enable-live-discovery-sources.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Enable the three real discovery_sources rows for the now-implemented
--   live crawler (discovery-worker/src/crawl.ts), set the crawlable
--   Oceanman calendar to the jsonld_html parser (listing-discovery mode),
--   set language hints, and make every enabled source immediately due.
--   The two "research umbrella" sources keep parser_type='manual', which
--   the crawler treats as verification-only: it re-fetches the URLs of
--   candidates the source already has (change monitoring) and never
--   crawls the base_url (swimloading.com/research is not a listing).
--   The synthetic fixture source (…0001) stays enabled=false forever.

-- Requested by:
--   Dave — "I want to build the live crawler next" (2026-08-03)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Expect exactly 3 rows, all enabled=false, next_run_at NULL:
--   SELECT id, name, parser_type, enabled, crawl_frequency, next_run_at
--   FROM discovery_sources
--   WHERE id IN ('00000000-0000-4000-8000-000000000010',
--                '00000000-0000-4000-8000-000000000011',
--                '00000000-0000-4000-8000-000000000012');
--
-- Expect the fixture source untouched by this migration (enabled=false):
--   SELECT id, enabled FROM discovery_sources
--   WHERE id = '00000000-0000-4000-8000-000000000001';
--
-- Affected-row count (expect 3):
--   SELECT count(*) FROM discovery_sources
--   WHERE id IN ('00000000-0000-4000-8000-000000000010',
--                '00000000-0000-4000-8000-000000000011',
--                '00000000-0000-4000-8000-000000000012');

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260803_discovery_sources AS
  SELECT * FROM discovery_sources
  WHERE id IN ('00000000-0000-4000-8000-000000000010',
               '00000000-0000-4000-8000-000000000011',
               '00000000-0000-4000-8000-000000000012');

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Oceanman: the one source with a real crawlable calendar page. Listing
-- mode discovers per-race pages from /races. Weekly, because listing
-- discovery is how NEW races appear. Languages: their races span Spanish/
-- Italian/Turkish-speaking venues; site serves English variants.
UPDATE discovery_sources
SET enabled = true,
    parser_type = 'jsonld_html',
    crawl_frequency = 'weekly',
    language_codes = ARRAY['en','es','it','tr'],
    next_run_at = now(),
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000010';

-- The two researched umbrella sources: verification-only re-crawl of the
-- 25 candidate source URLs they already carry (parser_type stays
-- 'manual' — the crawler's verification mode). Weekly keeps dates fresh
-- without hammering ~20 small organiser sites.
UPDATE discovery_sources
SET enabled = true,
    crawl_frequency = 'weekly',
    next_run_at = now(),
    updated_at = now()
WHERE id IN ('00000000-0000-4000-8000-000000000011',
             '00000000-0000-4000-8000-000000000012');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- UPDATE discovery_sources s
-- SET enabled = b.enabled,
--     parser_type = b.parser_type,
--     crawl_frequency = b.crawl_frequency,
--     language_codes = b.language_codes,
--     next_run_at = b.next_run_at,
--     updated_at = now()
-- FROM _bak_20260803_discovery_sources b
-- WHERE s.id = b.id;
-- (Or simply: UPDATE discovery_sources SET enabled=false WHERE id IN
--  ('…0010','…0011','…0012'); — the crawler ignores disabled sources.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT id, name, parser_type, enabled, crawl_frequency,
--        language_codes, next_run_at
-- FROM discovery_sources ORDER BY name;
--   -- expect: fixture source enabled=false;
--   --         Oceanman enabled=true, parser_type='jsonld_html', weekly, next_run_at set;
--   --         both umbrella sources enabled=true, parser_type='manual', weekly, next_run_at set.
-- SELECT count(*) FROM discovery_sources WHERE enabled = true;   -- expect: 3
