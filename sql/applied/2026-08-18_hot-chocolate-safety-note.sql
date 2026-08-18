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
-- Migration: 2026-08-18_hot-chocolate-safety-note.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Set safety_note on the Camps Bay Hot Chocolate Swim. It is an informal
--   standing Sunday swim with no water safety on hand, and /explore already
--   renders safety_note in amber with a warning icon — the field was simply
--   NULL, so the swim was listed with no caveat at all. PodSquad North
--   Cottesloe already carries this exact wording; this brings the only other
--   regular group swim into line.

-- Requested by:
--   Dave, 18 Aug 2026 — wording supplied verbatim, not written by me.

-- Note: no code change needed. loadRecurring() already selects safety_note
-- and renderRegulars() already renders it.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
--   -- Exactly one row targeted, and it currently has no note (expect 1, NULL):
--   SELECT count(*) AS rows_affected,
--          bool_and(safety_note IS NULL) AS all_currently_null
--     FROM recurring_swims
--    WHERE slug = 'hot-chocolate-swim-camps-bay';

-- ----------------------------------------------------------------
-- BACKUP — required: this migration contains an UPDATE.
-- ----------------------------------------------------------------
--   Created as part of the transaction below.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS _bak_20260818_recurring_swims AS
SELECT * FROM recurring_swims WHERE slug = 'hot-chocolate-swim-camps-bay';

UPDATE recurring_swims
   SET safety_note = 'Informal swim — there is no water safety on hand, so everyone swims at their own risk. Only swim in conditions you feel capable and confident in.',
       updated_at  = now()
 WHERE slug = 'hot-chocolate-swim-camps-bay';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   UPDATE recurring_swims r
--      SET safety_note = b.safety_note, updated_at = b.updated_at
--     FROM _bak_20260818_recurring_swims b
--    WHERE r.slug = b.slug;
--   -- then, once satisfied:
--   -- DROP TABLE _bak_20260818_recurring_swims;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- Both regular group swims now carry a note, worded identically:
--   SELECT slug, safety_note IS NOT NULL AS has_note, safety_note
--     FROM recurring_swims ORDER BY slug;
--
--   -- The backup holds the pre-change row (expect 1, NULL):
--   SELECT count(*), bool_and(safety_note IS NULL) FROM _bak_20260818_recurring_swims;
