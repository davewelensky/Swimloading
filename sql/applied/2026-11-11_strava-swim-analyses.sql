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
-- Migration: 2026-11-11_strava-swim-analyses.sql
-- ================================================================

-- Purpose:
--   Store the hour-by-hour summary of a swimmer's long Strava swims (2 hours or
--   more), built by /api/strava/streams from Strava's per-second data. Only the
--   summary is stored, never raw streams or GPS tracks. Strava's API agreement
--   allows a user's data to be shown to that user only, so the owner is the only
--   reader: no admin policy. No existing data touched.

-- Requested by:
--   Dave (11 Nov 2026): "build the per-second strava data for long swims".

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'strava_swim_analyses';   -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — not needed: additive only.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.strava_swim_analyses (
    user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    strava_activity_id bigint NOT NULL,
    summary            jsonb NOT NULL,
    fetched_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, strava_activity_id)
);

ALTER TABLE public.strava_swim_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY strava_swim_analyses_owner_all ON public.strava_swim_analyses
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.strava_swim_analyses FROM anon;
REVOKE ALL ON public.strava_swim_analyses FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strava_swim_analyses TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE public.strava_swim_analyses;   -- summaries can be rebuilt from Strava on demand

-- ----------------------------------------------------------------
-- VERIFY — read-only
-- ----------------------------------------------------------------
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.strava_swim_analyses'::regclass;   -- expect true
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'strava_swim_analyses';         -- expect owner_all ALL only
-- SELECT has_table_privilege('anon', 'public.strava_swim_analyses', 'SELECT');               -- expect false
