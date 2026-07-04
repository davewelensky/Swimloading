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
      E'\n\nWRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).'
      USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-07-04_spot-water-readings.sql
-- ================================================================

-- Purpose:
--   Water-temperature intelligence — Phase 1. New table to hold MODELLED sea
--   surface temperature (Open-Meteo Marine now; Copernicus later) kept SEPARATE
--   from swimmer-reported temp_logs so model data never pollutes the community
--   feed, the "temps logged" count, or points/leaderboard triggers.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- (Non-destructive migration: no UPDATE/DELETE, so no backup required.)
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.spots') IS NOT NULL          AS spots_exists;       -- expect true
-- SELECT to_regclass('public.spot_water_readings') IS NULL AS table_is_new;      -- expect true
-- SELECT count(*) FILTER (WHERE water_type IN ('OCEAN','LAGOON')) AS coastal_spots,
--        count(*) AS active_spots
--   FROM public.spots WHERE active IS NOT FALSE;                                  -- ~95 coastal / ~180 active

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.spot_water_readings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id       uuid NOT NULL REFERENCES public.spots(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('open_meteo','copernicus')),
  sst_c         numeric,                       -- sea surface temperature °C (null if model has none for this cell)
  wave_height_m numeric,                        -- optional sea state from the marine model
  observed_at   timestamptz NOT NULL,           -- the model's valid time (which hour this value is for), UTC
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  raw           jsonb,                           -- trimmed API payload, kept for future/debug
  UNIQUE (spot_id, source, observed_at)          -- idempotent upserts; keeps history over time
);

COMMENT ON TABLE public.spot_water_readings IS
  'Modelled water temperature per spot (open_meteo | copernicus). Separate from swimmer temp_logs. Populated by /api/cron/marine-temps.';

CREATE INDEX idx_spot_water_readings_spot_source_time
  ON public.spot_water_readings (spot_id, source, observed_at DESC);

-- Latest reading per (spot, source) — what the app reads.
CREATE VIEW public.spot_water_latest
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (spot_id, source)
       spot_id, source, sst_c, wave_height_m, observed_at, fetched_at
FROM public.spot_water_readings
ORDER BY spot_id, source, observed_at DESC;

-- RLS: public read (temps are public data); writes are service-role only (cron
-- uses SUPABASE_SERVICE_KEY, which bypasses RLS — no anon/auth write policy).
ALTER TABLE public.spot_water_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read water readings"
  ON public.spot_water_readings FOR SELECT
  USING (true);

GRANT SELECT ON public.spot_water_readings TO anon, authenticated;
GRANT SELECT ON public.spot_water_latest   TO anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only, after apply):
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.spot_water_readings') AS tbl,   -- expect public.spot_water_readings
--        to_regclass('public.spot_water_latest')   AS vw;    -- expect public.spot_water_latest
-- SELECT relrowsecurity FROM pg_class WHERE relname='spot_water_readings';  -- expect true
-- SELECT count(*) FROM public.spot_water_readings;           -- expect 0 (cron not run yet)

-- ----------------------------------------------------------------
-- ROLLBACK (if needed):
-- ----------------------------------------------------------------
-- DROP VIEW  IF EXISTS public.spot_water_latest;
-- DROP TABLE IF EXISTS public.spot_water_readings;
