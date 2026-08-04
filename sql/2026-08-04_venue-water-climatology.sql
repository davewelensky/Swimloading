-- ================================================================
-- SwimLoading — Migration Template
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-04_venue-water-climatology.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Somewhere to keep "what this water typically does in this week of the
--   year", so /explore can answer the question people actually plan travel
--   around: what will it be like at this swim in March?
--
--   Today the only water temperature we hold is an OBSERVATION — today's
--   reading, refreshed 6-hourly, shown only within 14 days because beyond
--   that it means nothing. A climatology is a different kind of fact: a
--   statistic derived from twenty years of Copernicus reanalysis, valid for
--   a date months away, and never a forecast.
--
--   Separate table, not more rows in venue_water_readings, because the two
--   have nothing in common but a unit. A reading has an observed_at and is
--   superseded every six hours; a climatology has a baseline period and is
--   recomputed once a year. Mixing them would make "latest reading" a
--   question with two incompatible answers.
--
--   Populated by scripts/copernicus-climatology.py — a local one-off, not a
--   deployed service. See that file's header for why.
--
--   COVERAGE, stated up front: Copernicus SST is SEA surface temperature.
--   Ocean and sea only, 0.05 degree grid. Lakes, dams and rivers get
--   nothing here, exactly as they get nothing from Open-Meteo today. This
--   makes coastal venues answerable for any DATE; it does not widen which
--   VENUES are answerable at all.

-- Requested by:
--   Dave — 2026-08-04, "registered with Copernicus as dwelensky", after
--   "adding water temps and expected temps is a winner, people will travel
--   to a swim in the correct temp".

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name='venue_water_climatology';         -- expect 0
--
--   -- The venues this could ever cover, and the ones it cannot:
--   SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS with_coords,
--          count(*)                                     AS all_venues
--     FROM event_venues;
--
--   -- Today's observation coverage, as the comparison point. Anything
--   -- already getting a modelled reading is on the marine grid and should
--   -- get a climatology too:
--   SELECT count(*) FROM venue_water_latest WHERE source='open_meteo';

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- Not required: creates a new table and touches nothing existing.

BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_water_climatology (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid NOT NULL REFERENCES public.event_venues(id) ON DELETE CASCADE,
  source              text NOT NULL DEFAULT 'copernicus' CHECK (source IN ('copernicus', 'self_observed')),
  -- 1..52, with the final week absorbing the leftover days. Deliberately
  -- NOT ISO weeks: those slide against the calendar year, so "mid-August"
  -- would land in a different bucket depending on the year — the one thing
  -- a seasonal average must not do.
  week_of_year        smallint NOT NULL CHECK (week_of_year BETWEEN 1 AND 52),
  mean_c              numeric(4,1) NOT NULL,
  min_c               numeric(4,1),
  max_c               numeric(4,1),
  -- The headline range. p10/p90 rather than the extremes, so one freak day
  -- does not widen what a swimmer is told to expect — while min/max keep
  -- the freak day visible for anyone who looks.
  p10_c               numeric(4,1),
  p90_c               numeric(4,1),
  -- How much evidence is behind the number. This travels with the value
  -- everywhere it is shown: a mean of five years and a mean of twenty are
  -- not the same claim, and the UI must be able to say so.
  years_observed      smallint NOT NULL CHECK (years_observed >= 1),
  sample_days         integer,
  baseline_start_year smallint NOT NULL,
  baseline_end_year   smallint NOT NULL,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vwc_baseline_order CHECK (baseline_end_year >= baseline_start_year),
  CONSTRAINT vwc_range_order    CHECK (p90_c IS NULL OR p10_c IS NULL OR p90_c >= p10_c),
  -- Makes the script idempotent: re-running updates each venue-week in
  -- place rather than accumulating a new set every time.
  CONSTRAINT vwc_uniq UNIQUE (venue_id, week_of_year, source)
);

CREATE INDEX IF NOT EXISTS idx_vwc_venue_week
  ON public.venue_water_climatology (venue_id, week_of_year);

COMMENT ON TABLE public.venue_water_climatology IS
  'What the water at a venue TYPICALLY does in a given week of the year, '
  'from Copernicus reanalysis. Not a forecast and not an observation — a '
  'statistic over a stated baseline period, which is why years_observed and '
  'baseline_*_year are NOT NULL. Kept separate from venue_water_readings: a '
  'reading is superseded every six hours, this is recomputed once a year.';

ALTER TABLE public.venue_water_climatology ENABLE ROW LEVEL SECURITY;

-- Public read, worker-only write — the same shape as every other discovery
-- table. A swimmer comparing seasons should not need an account.
DROP POLICY IF EXISTS vwc_public_read ON public.venue_water_climatology;
CREATE POLICY vwc_public_read ON public.venue_water_climatology
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.venue_water_climatology TO anon, authenticated;

-- Convenience view: the expected temperature for a venue on a given date,
-- with its evidence attached. Deliberately a function of DATE rather than a
-- join on week, so callers cannot accidentally compute the week themselves
-- and disagree with how the table was built.
CREATE OR REPLACE FUNCTION public.venue_expected_temp(p_venue_id uuid, p_date date)
RETURNS TABLE(mean_c numeric, p10_c numeric, p90_c numeric,
              years_observed smallint, baseline text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT c.mean_c, c.p10_c, c.p90_c, c.years_observed,
         c.baseline_start_year || '–' || c.baseline_end_year
    FROM venue_water_climatology c
   WHERE c.venue_id = p_venue_id
     AND c.week_of_year = LEAST(52, (EXTRACT(DOY FROM p_date)::int - 1) / 7 + 1)
   ORDER BY c.years_observed DESC
   LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.venue_expected_temp(uuid, date) TO anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.venue_expected_temp(uuid, date);
-- DROP TABLE IF EXISTS public.venue_water_climatology;
-- COMMIT;
-- Nothing else references either object, so this is clean.

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM venue_water_climatology;          -- expect 0 until the script runs
--
-- The week arithmetic in venue_expected_temp must match week_of_year() in
-- scripts/copernicus-climatology.py exactly, or a date will read the wrong
-- week. Two spot values, computed the same way in both places:
-- SELECT LEAST(52, (EXTRACT(DOY FROM DATE '2026-01-01')::int - 1) / 7 + 1);  -- expect 1
-- SELECT LEAST(52, (EXTRACT(DOY FROM DATE '2026-08-15')::int - 1) / 7 + 1);  -- expect 33
-- SELECT LEAST(52, (EXTRACT(DOY FROM DATE '2028-12-31')::int - 1) / 7 + 1);  -- expect 52 (leap year)
-- Verified 2026-08-04: SQL and the script's week_of_year() agree on all four.
-- SELECT LEAST(52, (EXTRACT(DOY FROM DATE '2026-12-31')::int - 1) / 7 + 1);  -- expect 52
--
-- After the script has run, coverage should broadly match the venues that
-- already get a modelled reading — both come off the same marine grid:
-- SELECT count(DISTINCT venue_id) FROM venue_water_climatology;
-- SELECT count(*) FROM venue_water_latest WHERE source='open_meteo';
--
-- And a real answer:
-- SELECT v.display_name, (venue_expected_temp(v.id, DATE '2027-02-13')).*
--   FROM event_venues v WHERE v.display_name ILIKE '%midmar%';
