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
-- Migration: 2026-11-13_delete-old-tracey-drafts.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Delete three superseded, unpublished Tracey report drafts (7327c8ac, 17eab265, and a third, 525e5cd9, found afterwards) so Britt sees one Tracey in Recent reports.
--   Keeps the newest draft dfabb149-a996-4ad8-b183-699b0004911b.

-- Requested by:
--   Dave, 13 Nov 2026

-- Club / feature flag:
--   Aquasharks Lab (swim_lab_assessments, club_slug = aqua-sharks-atlantic). No flag; admin-only tool.

-- Applied by Dave in the Supabase SQL editor on 13 Nov 2026 (backup table holds all 3 rows). Dry-run (read-only): 2 rows, both status 'draft', no share_token, session_date 2026-11-13.

CREATE TABLE IF NOT EXISTS _bak_20261113_swim_lab_assessments AS
SELECT * FROM swim_lab_assessments
WHERE id IN ('7327c8ac-2765-4777-ac7e-8fcda7db025a', '17eab265-0302-43ae-a647-aba92de62274');
ALTER TABLE _bak_20261113_swim_lab_assessments ENABLE ROW LEVEL SECURITY;

DELETE FROM swim_lab_assessments
WHERE id IN ('7327c8ac-2765-4777-ac7e-8fcda7db025a', '17eab265-0302-43ae-a647-aba92de62274')
  AND status = 'draft' AND share_token IS NULL;

-- Verify (read-only, after apply):
--   SELECT count(*) FROM _bak_20261113_swim_lab_assessments;                       -- expect 2
--   SELECT id, status FROM swim_lab_assessments WHERE swimmer_name ILIKE 'Tracey%'; -- expect only dfabb149-...

-- Rollback:
--   INSERT INTO swim_lab_assessments SELECT * FROM _bak_20261113_swim_lab_assessments;
