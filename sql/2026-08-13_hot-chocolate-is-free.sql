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
-- Migration: 2026-08-13_hot-chocolate-is-free.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Set is_free = true on the Hot Chocolate Swim. It was inserted NULL an
--   hour ago because nobody had said so, and "these swims are usually
--   free" is not a fact. Dave has now stated it, so it is one.
--
--   This is the column working as intended: NULL meant "not stated", not
--   "no". The /explore card showed no Free badge in the meantime, which was
--   the correct thing to show for something we did not know.

-- Requested by:
--   Dave, 2026-08-13: "Hot Chocolate is free".

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT slug, is_free FROM public.recurring_swims
--  WHERE slug = 'hot-chocolate-swim-camps-bay';
-- expect: 1 row, is_free IS NULL

-- ----------------------------------------------------------------
-- BACKUP — not required: one nullable boolean, rollback below is exact.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE public.recurring_swims
   SET is_free = true,
       notes   = 'Supplied by Dave Welensky 2026-08-13 from direct local knowledge, not from a '
                 'published page — there is no organiser website to verify against. Distance is '
                 '"around 1.6km" as described, not a measured course. Confirmed free by Dave on '
                 '2026-08-13 (it was left NULL on first insert because nobody had stated it). '
                 'Safety arrangements are still unstated and remain NULL.',
       updated_at = now()
 WHERE slug = 'hot-chocolate-swim-camps-bay';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE public.recurring_swims SET is_free = NULL
--  WHERE slug = 'hot-chocolate-swim-camps-bay';

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT name, is_free, safety_note FROM public.recurring_swims ORDER BY name;
-- expect: Hot Chocolate Swim | true | NULL   (safety still unstated, still NULL)
--         PodSquad …         | true | (safety text)
-- Both cards should now show a Free badge on /explore.
