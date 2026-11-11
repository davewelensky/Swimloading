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
-- Migration: 2026-11-10_retire-sip-savour-dine-editions.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Take two "Sip, Savour & Dine" listings out of the swim catalogue. It is a
--   dinner evening at Point Watersports Club on 12 Nov 2026, not a swim. The
--   same evening was picked up from two club calendars (pwsc.co.za and
--   duc.co.za), so it is listed twice, and both titles carry an undecoded
--   ampersand ("&#038;" and "%26"). Both were showing in the eight-card swim
--   preview on the homepage.
--
--   Same method as 2026-08-13_retire-non-swim-editions.sql: the rows stay,
--   they are only switched off for search and for indexing.
--
--   NOT COVERED: nothing here stops the crawler listing the next club social
--   from these two calendars. That needs a title rule in the classifier.

-- Requested by:
--   Dave, 2026-11-10 — "remove the 2 x sip saviour and dines"

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT id, title, start_date, is_searchable, is_indexable
--   FROM event_editions
--  WHERE id IN ('90551fea-f442-4413-8ec7-d450f45f25d5',
--               'a9aca5f5-9915-47c5-8d21-4e678c82d7f6');
-- expect: 2 rows, both 2026-11-12, both is_searchable = true, is_indexable = true
--   (dry-run 2026-11-10: exactly that)
--
-- SELECT count(*) FROM event_editions WHERE title ILIKE '%sip%savour%';
-- expect: 2 (no third copy)   (dry-run 2026-11-10: 2)

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs existing rows.
-- Applied 2026-11-11 via supabase-admin, backup and update in ONE transaction
-- (the BEGIN sits above the backup so a failed update leaves no stray table).
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _bak_20261110_sip_savour_editions AS
  SELECT * FROM event_editions
   WHERE id IN ('90551fea-f442-4413-8ec7-d450f45f25d5',
                'a9aca5f5-9915-47c5-8d21-4e678c82d7f6');
ALTER TABLE _bak_20261110_sip_savour_editions ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- MIGRATION — applied after Dave typed "apply" (2026-11-11).
-- ----------------------------------------------------------------
UPDATE event_editions
   SET is_searchable = false,
       is_indexable  = false
 WHERE id IN ('90551fea-f442-4413-8ec7-d450f45f25d5',   -- "Sip, Savour &#038; Dine" (Point Water Sports Club — events)
              'a9aca5f5-9915-47c5-8d21-4e678c82d7f6');  -- "Sip, Savour %26 Dine"    (Durban Undersea Club — events)

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE event_editions e
--    SET is_searchable = b.is_searchable, is_indexable = b.is_indexable
--   FROM _bak_20261110_sip_savour_editions b WHERE e.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM event_editions
--  WHERE is_searchable AND title ILIKE '%sip%savour%';
-- expect: 0
--
-- SELECT count(*) FROM _bak_20261110_sip_savour_editions;
-- expect: 2
--
-- Live: /api/explore/events?sort=date&page=1&page_size=18 returns no row
-- whose name contains "Sip".
--
-- Result 2026-11-11: still searchable 0, hidden rows 2, backup rows 2 (RLS on,
-- holding the old searchable state); live API returned 0 "Sip" rows, total 703.
