-- ⚠️  SAFETY CHECK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-25_drop-20260818-backups.sql
-- ================================================================

-- Purpose:
--   Drop the eleven _bak_20260818_* tables. Every change they protect has
--   been live for a week and is verified below.

-- Requested by:
--   Dave, 25 Aug 2026.

-- THIS IS IRREVERSIBLE. There is no backup of a backup and none is wanted:
-- these exist to make a change undoable for a short while, and keeping them
-- forever turns a safety net into a pile of superseded snapshots that look
-- restorable and are not. That is not hypothetical here — see the
-- indexability table below.

-- ── What is being dropped, and why each is finished ──────────────────────
--
--   _bak_20260818_edition_titles         2 rows   HTML entity decode
--   _bak_20260818_series_names           2 rows   same, event_series side
--     Verified 25 Aug: 0 titles and 0 series names still contain an entity.
--
--   _bak_20260818_event_slugs          316 rows   slug renames
--     Redundant rather than merely old: event_editions.previous_slugs now
--     holds every old slug in the live table, and 27 editions carry one.
--     The redirect does not depend on this backup and never did.
--
--   _bak_20260818_recurring_swims        1 row    Hot Chocolate safety note
--     Verified 25 Aug: the note is present.
--
--   _bak_20260818_indexability         256 rows   the override I reverted
--     ⚠️  ACTIVELY MISLEADING NOW, which is the strongest reason to drop it.
--     It was accurate the moment the revert finished — 0 rows differed. It
--     no longer is: 62 rows differ today. 49 of those are ai_fallback
--     editions a human approved at /discovery-review, made indexable on
--     purpose by 2026-08-20_approved-ai-candidates-are-indexable.sql, and
--     13 are events whose dates have passed. Restoring this snapshot would
--     silently undo a deliberate policy change and re-index 13 finished
--     swims. A backup that would do damage if used is worse than no backup.
--
--   _bak_20260818_gap_spots             16 rows   the 18 Aug incident
--   _bak_20260818_gap_suggestions       25 rows   same
--     The 16 mis-domained US spots retired and 6 rebuilt at geocoded
--     shorelines. Live for a week; the three guards added at the time
--     (requireCountry, autoSetDomain, addSpot) are what prevent a repeat,
--     not these rows.
--
--   _bak_20260818_santa_ponca_spot       1 row    Mallorca duplicate merge
--   _bak_20260818_santa_ponca_temp_logs  1 row
--   _bak_20260818_santa_ponca_stations   1 row
--   _bak_20260818_santa_ponca_challenge  1 row
--     Verified 25 Aug: one Santa Ponsa active, the duplicate retired, and
--     the 301 for the old slug is in vercel.json rather than in this data.

-- NOT dropped: the other 70 _bak_ tables, dating from 20 July to 23 August.
-- Dave asked for the 20260818 set and that is what this does. The oldest are
-- five weeks old and worth their own sweep, but each needs the same
-- discharge check this file does — a blanket drop by age is exactly how a
-- backup that was still load-bearing disappears.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying. All verified 25 Aug 2026.
-- ----------------------------------------------------------------
--   -- Eleven tables, and the row counts above (expect 11):
--   SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE '\_bak\_20260818\_%';
--
--   -- Every protected change still in place (expect 0,0,27,1,1,1):
--   SELECT (SELECT count(*) FROM event_editions WHERE title ~ '&#[0-9]+;')          AS titles_encoded,
--          (SELECT count(*) FROM event_series WHERE display_name ~ '&#[0-9]+;')     AS series_encoded,
--          (SELECT count(*) FROM event_editions WHERE cardinality(previous_slugs)>0) AS slugs_remembered,
--          (SELECT count(*) FROM recurring_swims
--            WHERE slug='hot-chocolate-swim-camps-bay' AND safety_note IS NOT NULL)  AS hot_choc_note,
--          (SELECT count(*) FROM spots WHERE lower(name) LIKE 'santa pon%' AND active)     AS santa_active,
--          (SELECT count(*) FROM spots WHERE lower(name) LIKE 'santa pon%' AND NOT active) AS santa_retired;

-- ----------------------------------------------------------------
-- BACKUP — none. These ARE the backups; the changes they cover are
-- verified live above. Backing up a backup only defers the decision.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

DROP TABLE IF EXISTS public._bak_20260818_edition_titles;
DROP TABLE IF EXISTS public._bak_20260818_series_names;
DROP TABLE IF EXISTS public._bak_20260818_event_slugs;
DROP TABLE IF EXISTS public._bak_20260818_indexability;
DROP TABLE IF EXISTS public._bak_20260818_recurring_swims;
DROP TABLE IF EXISTS public._bak_20260818_gap_spots;
DROP TABLE IF EXISTS public._bak_20260818_gap_suggestions;
DROP TABLE IF EXISTS public._bak_20260818_santa_ponca_spot;
DROP TABLE IF EXISTS public._bak_20260818_santa_ponca_temp_logs;
DROP TABLE IF EXISTS public._bak_20260818_santa_ponca_stations;
DROP TABLE IF EXISTS public._bak_20260818_santa_ponca_challenge;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — IRREVERSIBLE. There is no restore for a dropped backup
-- table. The changes they covered remain live and verified; recovering
-- the snapshots themselves would need a point-in-time restore of the
-- whole database from Supabase, which is not worth doing for these.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- None of the eleven remain (expect 0):
--   SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE '\_bak\_20260818\_%';
--
--   -- The other backups are untouched (expect 70 — 81 before this ran):
--   SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE '\_bak\_%';
--
--   -- And nothing they protected regressed (expect 0,0,27,1):
--   SELECT (SELECT count(*) FROM event_editions WHERE title ~ '&#[0-9]+;')           AS titles_encoded,
--          (SELECT count(*) FROM event_series WHERE display_name ~ '&#[0-9]+;')      AS series_encoded,
--          (SELECT count(*) FROM event_editions WHERE cardinality(previous_slugs)>0) AS slugs_remembered,
--          (SELECT count(*) FROM recurring_swims
--            WHERE slug='hot-chocolate-swim-camps-bay' AND safety_note IS NOT NULL)  AS hot_choc_note;
