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
-- Migration: 2026-11-11_crossing-feed-tests.sql
-- ================================================================

-- Purpose:
--   New table for feed tests on long open-water swims, shown on the
--   /crossing-prep Feeding tab: what the swimmer took, how strong, how often,
--   and how their stomach and energy held up. Carbohydrate per hour is worked
--   out by the database. Swimmers manage their own rows; Dave can read and
--   manage all. Optional sweat checks reuse the existing sweat_tests table,
--   whose policy already allows the swimmer and Dave. No existing data touched.

-- Requested by:
--   Dave (11 Nov 2026), for Peter Emslie, modelled on Carina's /PHtest page.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'crossing_feed_tests';   -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — not needed: additive only.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.crossing_feed_tests (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    swim_date          date NOT NULL,
    duration_minutes   integer CHECK (duration_minutes > 0),
    distance_km        numeric CHECK (distance_km > 0),
    water_temp_c       numeric CHECK (water_temp_c BETWEEN 0 AND 35),
    product            text NOT NULL,
    mix_note           text,
    carbs_per_feed_g   numeric CHECK (carbs_per_feed_g >= 0),
    feed_volume_ml     integer CHECK (feed_volume_ml >= 0),
    feed_interval_min  integer CHECK (feed_interval_min > 0),
    first_feed_min     integer CHECK (first_feed_min >= 0),
    warm_feeds         boolean NOT NULL DEFAULT false,
    solids             text,
    carbs_per_hour_g   numeric GENERATED ALWAYS AS (
                         CASE WHEN feed_interval_min > 0 AND carbs_per_feed_g IS NOT NULL
                              THEN round(carbs_per_feed_g * 60.0 / feed_interval_min, 1) END
                       ) STORED,
    stomach_comfort    smallint CHECK (stomach_comfort BETWEEN 1 AND 5),
    nausea             boolean NOT NULL DEFAULT false,
    vomited            boolean NOT NULL DEFAULT false,
    energy_steady      smallint CHECK (energy_steady BETWEEN 1 AND 5),
    faded_end          boolean NOT NULL DEFAULT false,
    notes              text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crossing_feed_tests_user_idx ON public.crossing_feed_tests (user_id, swim_date DESC);

ALTER TABLE public.crossing_feed_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY crossing_feed_tests_owner_all ON public.crossing_feed_tests
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY crossing_feed_tests_admin_all ON public.crossing_feed_tests
    FOR ALL TO authenticated
    USING (auth.uid() = 'df137255-3add-4153-b368-32e06e2be188'::uuid)
    WITH CHECK (auth.uid() = 'df137255-3add-4153-b368-32e06e2be188'::uuid);

REVOKE ALL ON public.crossing_feed_tests FROM anon;
REVOKE ALL ON public.crossing_feed_tests FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crossing_feed_tests TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE public.crossing_feed_tests;   -- removes every feed test; export rows first

-- ----------------------------------------------------------------
-- VERIFY — read-only
-- ----------------------------------------------------------------
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.crossing_feed_tests'::regclass;   -- expect true
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'crossing_feed_tests' ORDER BY 1;
--   expect: crossing_feed_tests_admin_all ALL, crossing_feed_tests_owner_all ALL
-- SELECT has_table_privilege('anon', 'public.crossing_feed_tests', 'SELECT');                -- expect false
-- SELECT is_generated FROM information_schema.columns
--  WHERE table_name = 'crossing_feed_tests' AND column_name = 'carbs_per_hour_g';            -- expect ALWAYS
