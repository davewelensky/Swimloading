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
-- Migration: 2026-11-13_delete-test-lab-reports.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Remove four test reports from swim_lab_assessments so Britt's Recent reports shows only real swimmers:
--   "Test Swimmer A (TEST ROW)" (published sample, token nBU8...), Johann's superseded draft, and two published
--   "Dave" test reports (swim date 17 Aug). Kept: Johann (published), Jenson (published), Tracey (draft).

-- Requested by:
--   Dave, 13 Nov 2026. Applied by Dave in the Supabase SQL editor; verified read-only afterwards (3 reports remain,
--   backup table holds all 7 rows deleted that day, including the three superseded Tracey drafts).

-- Club / feature flag:
--   Aquasharks Lab (admin-only tool). No flag.

INSERT INTO _bak_20261113_swim_lab_assessments
SELECT * FROM swim_lab_assessments
WHERE id IN ('4801c81a-76bd-4344-a2f7-f08f649c3314', '3e90e0e1-bbe0-4468-8225-442dfbaad546', '24a71929-0a0a-4db3-9e48-863a42204634', 'c3c29959-675e-4a43-adc5-4dc950f5c0c1');

DELETE FROM swim_lab_assessments
WHERE id IN ('4801c81a-76bd-4344-a2f7-f08f649c3314', '3e90e0e1-bbe0-4468-8225-442dfbaad546', '24a71929-0a0a-4db3-9e48-863a42204634', 'c3c29959-675e-4a43-adc5-4dc950f5c0c1');

-- Rollback:
--   INSERT INTO swim_lab_assessments SELECT * FROM _bak_20261113_swim_lab_assessments WHERE id IN (<the ids above>);
