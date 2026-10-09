-- Migration: 2026-10-09_getstoked-followup-date.sql   (APPLIED 9 Oct 2026)
-- Purpose:   Set the Therabody / Get Stoked pipeline follow-up date to 16 Oct 2026 (the 28 Sep date was past).
-- Requested by: Dave ("set follow-up to 16 Oct, leave status as In Discussion")
-- Pre-checks (read-only, 9 Oct 2026): 1 matching row; follow_up_date is type date, was 2026-09-28; status In Discussion.
-- Backup: not new. _bak_20261009_growth_sponsors_therabody (RLS on) already holds this row with the old date.
-- Rows updated: 1. Status is deliberately NOT changed: the WHERE clause also requires status = 'In Discussion'.
-- Applied via the supabase-admin tool; the safety check below aborts if run against the wrong project.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key = 'project_name' AND value = 'swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT - MIGRATION ABORTED';
  END IF;
END $$;

UPDATE growth_sponsors
SET follow_up_date = DATE '2026-10-16',
    updated_at     = now()
WHERE id = '556cd44c-3f53-43ea-b15d-b6395ed516ce'
  AND status = 'In Discussion';

-- Post-verify: SELECT status, follow_up_date FROM growth_sponsors WHERE id = '556cd44c-3f53-43ea-b15d-b6395ed516ce';
--              expect 'In Discussion', 2026-10-16
