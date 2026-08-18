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
      '║  This migration is for: SwimLoading                      ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh             ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-18_decode-html-entities-in-titles.sql
-- ================================================================

-- Purpose:
--   Two event titles carry an un-decoded HTML entity from the crawler and
--   render literally on /explore as "PAN PACIFIC JUNIOR &#8211; NATACION".
--   &#8211; is an en dash. This decodes it. Nothing is invented — the
--   character the entity stands for is substituted for the entity.

-- Requested by:
--   Dave, 18 Aug 2026.

-- Scope:
--   TWO tables, not one. event_editions.title has 2 rows, and
--   event_series.display_name has the same 2 swims recorded again — the
--   series name is the fallback shown when an edition has no title of its
--   own, so fixing only the editions would have left the entity visible
--   anywhere the series name is used. Checked across the whole table, not
--   just the searchable window: a row out of range today can come back into
--   it. event_venues.display_name: 0 affected.

-- NOT changed — the slugs:
--   pan-pacific-junior-8211-natacion-2026
--   pan-pacific-mayores-8211-natacion-2026
--   They carry "8211" too, but a published slug is a permanent URL (see
--   GROWTH_HUB.md). Renaming them breaks any link already shared and any
--   search engine result already indexed. If they are ever worth tidying it
--   is as a rename PLUS a 301 from the old slug, not a silent UPDATE.

-- Root cause, not fixed here:
--   The crawler stores the source's raw HTML text without decoding entities.
--   Only these 2 of 316 rows are affected today, so this cleans up the
--   symptom; decoding at ingest is the durable fix and is a separate change.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
--   -- Expect 2, and the decoded form alongside each (verified 2026-08-18):
--   SELECT id, slug, title, replace(title, '&#8211;', '–') AS decoded
--     FROM event_editions WHERE title LIKE '%&#8211;%';
--
--   -- Nothing else is entity-encoded (expect only those same 2):
--   SELECT count(*) FROM event_editions WHERE title ~ '&#[0-9]+;|&[a-z]+;';

-- ----------------------------------------------------------------
-- BACKUP — required: this migration contains an UPDATE.
-- ----------------------------------------------------------------
--   Created inside the transaction below.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS _bak_20260818_edition_titles AS
SELECT id, slug, title, now() AS backed_up_at
  FROM event_editions
 WHERE title LIKE '%&#8211;%';

CREATE TABLE IF NOT EXISTS _bak_20260818_series_names AS
SELECT id, display_name, now() AS backed_up_at
  FROM event_series
 WHERE display_name LIKE '%&#8211;%';

UPDATE event_editions
   SET title = replace(title, '&#8211;', '–'),
       updated_at = now()
 WHERE title LIKE '%&#8211;%';

UPDATE event_series
   SET display_name = replace(display_name, '&#8211;', '–')
 WHERE display_name LIKE '%&#8211;%';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   UPDATE event_editions e
--      SET title = b.title
--     FROM _bak_20260818_edition_titles b
--    WHERE e.id = b.id;
--   UPDATE event_series s
--      SET display_name = b.display_name
--     FROM _bak_20260818_series_names b
--    WHERE s.id = b.id;
--   -- then, once satisfied:
--   -- DROP TABLE _bak_20260818_edition_titles;
--   -- DROP TABLE _bak_20260818_series_names;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- No entity-encoded names remain in either table (expect 0, 0):
--   SELECT (SELECT count(*) FROM event_editions WHERE title ~ '&#[0-9]+;|&[a-z]+;')        AS editions,
--          (SELECT count(*) FROM event_series  WHERE display_name ~ '&#[0-9]+;|&[a-z]+;') AS series;
--
--   -- The two rows now read correctly, slugs untouched:
--   SELECT slug, title FROM event_editions
--    WHERE id IN (SELECT id FROM _bak_20260818_edition_titles);
--
--   -- The backup holds the pre-change titles (expect 2):
--   SELECT count(*) FROM _bak_20260818_edition_titles;
