-- ================================================================
-- SwimLoading — Migration
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
-- Migration: 2026-11-11_publish-peter-programme.sql
-- ================================================================

-- Purpose:
--   Publish Peter Emslie's English Channel programme so it appears on his
--   /crossing-prep Programme tab. Sets published_at on his one draft row.

-- Requested by:
--   Dave (11 Nov 2026): "publish it to peter".

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only
-- ----------------------------------------------------------------
-- SELECT count(*), bool_and(published_at IS NULL) FROM public.crossing_programmes
--  WHERE user_id = '9b1445e8-cce5-4501-a038-489146d15ab2';   -- expect 1, true

-- ----------------------------------------------------------------
-- BACKUP — the row before the update (plan holds health details, so RLS on)
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _bak_20261111_crossing_programmes AS
  SELECT * FROM public.crossing_programmes
   WHERE user_id = '9b1445e8-cce5-4501-a038-489146d15ab2';
ALTER TABLE _bak_20261111_crossing_programmes ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
UPDATE public.crossing_programmes
   SET published_at = now(), updated_at = now()
 WHERE user_id = '9b1445e8-cce5-4501-a038-489146d15ab2'
   AND published_at IS NULL;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE public.crossing_programmes SET published_at = NULL
--  WHERE user_id = '9b1445e8-cce5-4501-a038-489146d15ab2';

-- ----------------------------------------------------------------
-- VERIFY — read-only
-- ----------------------------------------------------------------
-- SELECT count(*) FILTER (WHERE published_at IS NOT NULL) FROM public.crossing_programmes
--  WHERE user_id = '9b1445e8-cce5-4501-a038-489146d15ab2';                       -- expect 1
-- SELECT count(*) FROM _bak_20261111_crossing_programmes;                        -- expect 1
-- SELECT relrowsecurity FROM pg_class WHERE oid = '_bak_20261111_crossing_programmes'::regclass;  -- expect true
