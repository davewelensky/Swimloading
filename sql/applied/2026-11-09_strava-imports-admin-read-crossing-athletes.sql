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
-- Migration: 2026-11-09_strava-imports-admin-read-crossing-athletes.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    APPLIED 9 Nov 2026 via supabase-admin after Dave typed "apply".
-- ================================================================

-- Purpose:
--   /crossing-prep?uid= (Dave's admin view) reads strava_imports, whose read policies are
--   owner-only, so Dave sees an athlete's temperature logs but none of their Strava swims
--   and 0 km. Add one SELECT policy for Dave's account only, limited to athletes who have
--   a crossing attempt. The table holds GPS tracks, heart rate and raw Strava payloads
--   for all members, so the rest of the membership stays owner-only.
--   Read access only. No rows change, and every other user's access is unchanged.

-- Requested by:
--   Dave, 9 Nov 2026, after finding Peter Emslie's Strava swims invisible in admin view

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.strava_imports'::regclass;   -- expect true
-- SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='strava_imports'
--   AND policyname='strava_imports_admin_select_crossing_athletes';                    -- expect 0
-- SELECT count(*) FROM auth.users WHERE id='df137255-3add-4153-b368-32e06e2be188';     -- expect 1
-- SELECT count(DISTINCT user_id) FROM crossing_attempts;                               -- athletes this would expose to Dave's login

-- ----------------------------------------------------------------
-- BACKUP — not required: no DELETE / UPDATE / DROP / TRUNCATE of data.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE POLICY strava_imports_admin_select_crossing_athletes
  ON public.strava_imports
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = 'df137255-3add-4153-b368-32e06e2be188'::uuid
    AND EXISTS (
      SELECT 1 FROM public.crossing_attempts a
      WHERE a.user_id = strava_imports.user_id
    )
  );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP POLICY strava_imports_admin_select_crossing_athletes ON public.strava_imports;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT cmd, roles, qual FROM pg_policies WHERE schemaname='public'
--   AND tablename='strava_imports' AND policyname='strava_imports_admin_select_crossing_athletes';
--   expect: one row, SELECT, {authenticated}, qual names Dave's id and crossing_attempts
-- SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='strava_imports';
--   expect: 7 (the 6 existing policies plus this one)
-- Functional check: Dave opens an athlete with an attempt via /dave and sees Strava km.
