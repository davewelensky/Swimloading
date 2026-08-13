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
-- Migration: 2026-08-13_retire-cross-source-duplicates.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Retire 2 more live duplicates, found by the cross-source dedupe fix
--   before it shipped. Each is one race listed by an aggregator AND by the
--   organiser; the organiser copy survives (confidence 85 vs 50-55).
--
--     Waikiki Roughwater        (Ray's Notebook, 55)  ->  retire
--     Waikiki Roughwater Swim   (organiser, 85)       ->  KEEP
--     Lorne Pier to Pub         (oceanswims, 50)      ->  retire
--     Powercor Lorne Pier to Pub(organiser, 85)       ->  KEEP
--
--   WHY THE EARLIER SWEEP MISSED THESE. This morning's duplicate hunt
--   grouped by an exact normalised title. "Waikiki Roughwater" and
--   "Waikiki Roughwater Swim" do not normalise to the same key, and
--   "Powercor" is a sponsor prefix on the same race. Only a similarity
--   score catches either — which is precisely the comparison that
--   fetchExistingCandidatesForDedupe could not make until now, because it
--   filtered .eq('source_id', ...) and these pairs come from two sources.
--
--   A simulation of the fixed comparison over all 2246 candidates flagged
--   27 cross-source pairs in total — not a flood — of which these two are
--   the only ones where both sides are still live.

-- Requested by:
--   Dave, 2026-08-13 — "fix the cross-source dedupe".

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT id, title, is_searchable, confidence_score FROM event_editions
--  WHERE id IN ('c33c0bf6-ab14-411b-8787-65fb8a8eb971',   -- Waikiki Roughwater (retire)
--               'b908f3b1-b87a-4365-9cdd-a92834888469',   -- Waikiki Roughwater Swim (keep)
--               '436396e0-3e97-4295-8144-7d341b37b1a9',   -- Lorne Pier to Pub (retire)
--               '0d39a006-1b90-4a1b-bca2-2629897d33bb');  -- Powercor Lorne Pier to Pub (keep)
-- expect: 4 rows, ALL is_searchable = true

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs existing rows.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260813_cross_source_dupes AS
--   SELECT * FROM event_editions
--    WHERE id IN ('c33c0bf6-ab14-411b-8787-65fb8a8eb971','436396e0-3e97-4295-8144-7d341b37b1a9');

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE event_editions
   SET is_searchable = false,
       is_indexable  = false
 WHERE id IN (
    'c33c0bf6-ab14-411b-8787-65fb8a8eb971',  -- Waikiki Roughwater — aggregator copy
    '436396e0-3e97-4295-8144-7d341b37b1a9'   -- Lorne Pier to Pub — aggregator copy
 );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE event_editions e
--    SET is_searchable = b.is_searchable, is_indexable = b.is_indexable
--   FROM _bak_20260813_cross_source_dupes b WHERE e.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT title, is_searchable FROM event_editions
--  WHERE title ILIKE '%waikiki roughwater%' OR title ILIKE '%lorne pier to pub%'
--  ORDER BY title;
-- expect: exactly one live Waikiki (…Swim) and one live Lorne (Powercor…)
--
-- SELECT total_count FROM search_events_v2(p_include_multisport := false) LIMIT 1;
-- expect: 2 fewer (335 -> 333)
