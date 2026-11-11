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
-- Migration: 2026-11-11_crossing-week-plans.sql
-- ================================================================

-- Purpose:
--   Store the AI-planned sessions for a swimmer's current week, shown on the
--   /crossing-prep Programme tab, so a plan is generated once per week unless
--   the swimmer asks to re-plan. Built partly from Strava volumes, so the owner
--   is the only reader (Strava terms: a user's data is shown to that user only).
--   No existing data touched.

-- Requested by:
--   Dave (11 Nov 2026): "use intelligence to guide his sessions".

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'crossing_week_plans';   -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — not needed: additive only.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.crossing_week_plans (
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    week_start date NOT NULL,
    plan       jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, week_start)
);

ALTER TABLE public.crossing_week_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY crossing_week_plans_owner_all ON public.crossing_week_plans
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.crossing_week_plans FROM anon;
REVOKE ALL ON public.crossing_week_plans FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crossing_week_plans TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE public.crossing_week_plans;   -- weekly plans can be regenerated

-- ----------------------------------------------------------------
-- VERIFY — read-only
-- ----------------------------------------------------------------
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.crossing_week_plans'::regclass;   -- expect true
-- SELECT policyname FROM pg_policies WHERE tablename = 'crossing_week_plans';              -- expect owner_all only
-- SELECT has_table_privilege('anon', 'public.crossing_week_plans', 'SELECT');               -- expect false
