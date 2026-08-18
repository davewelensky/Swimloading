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
-- Migration: 2026-08-18_measured-into-spot-temp-estimate.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Add MEASURED observations (approved primary buoy/sensor stations) as a
--   third source in spot_temp_estimate, so the app — which already reads
--   this view — shows real instrument readings instead of only swimmer logs
--   and the Open-Meteo model. Until now measured data reached the public
--   /spots/* pages only.
--
--   PRECEDENCE, and why. A swimmer in the water at the spot stays first:
--   they are ground truth AT the place, which a buoy 1–15 km away is not.
--   A live instrument reading (≤6h) then beats the model, because it is a
--   measurement of real water rather than a computation about it. The model
--   keeps its place above older measured readings, since it is always
--   "now" while a 30-hour-old buoy value is history.
--
--     1. swimmer  < 24h      (UNCHANGED — existing behaviour preserved)
--     2. measured < 6h       (NEW)
--     3. model                (unchanged position)
--     4. measured < 48h      (NEW)
--     5. swimmer  < 7d       (unchanged)
--     6. NULL
--
--   Purely additive for consumers: existing columns keep their names,
--   meanings and types, and all three readers (app.js, api/explore/places.js,
--   api/sitemap-dynamic.js) select explicit column lists.
--
--   NOTE: app.js must ship in the same change. Its _spTempChip() labels any
--   non-'model' source as "Swimmer reading", so a 'measured' value would be
--   captioned as if a person had taken it. That is exactly the kind of false
--   claim this project refuses to make.

-- Requested by:
--   Dave ("get the temps into the app", 2026-08-18)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- 1. How many spots have an approved primary with a usable reading
--    (these are the only rows whose best_source can change):
-- SELECT count(*) FROM spot_conditions_live
--  WHERE is_primary AND water_temperature_c IS NOT NULL;   -- expect: 9
-- 2. Of those, how many currently resolve to swimmer <24h (which the new
--    view must NOT change):
-- SELECT count(*) FROM spot_temp_estimate e
--  JOIN spot_conditions_live c ON c.spot_id = e.spot_id AND c.is_primary
--  WHERE e.best_source = 'swimmer' AND e.swimmer_age_h < 24;
-- 3. Current source mix, to compare after:
-- SELECT best_source, confidence, count(*) FROM spot_temp_estimate
--  GROUP BY 1,2 ORDER BY 1,2;
-- This migration replaces a VIEW definition. No table row is read, written
-- or deleted, so there are no affected-row counts.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required for data (no table is touched). The previous view definition
-- is preserved in the ROLLBACK section below verbatim, which is the
-- equivalent safeguard for a CREATE OR REPLACE VIEW.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE VIEW spot_temp_estimate
WITH (security_invoker = true) AS
WITH swimmer AS (
  SELECT DISTINCT ON (temp_logs.spot_id)
         temp_logs.spot_id,
         temp_logs.temp_c AS swimmer_c,
         COALESCE(temp_logs.logged_at, temp_logs.created_at) AS swimmer_at
    FROM temp_logs
   WHERE temp_logs.temp_c IS NOT NULL
   ORDER BY temp_logs.spot_id, (COALESCE(temp_logs.logged_at, temp_logs.created_at)) DESC
), model AS (
  SELECT spot_water_latest.spot_id,
         spot_water_latest.sst_c AS model_c,
         spot_water_latest.observed_at AS model_at
    FROM spot_water_latest
   WHERE spot_water_latest.source = 'open_meteo'::text
), measured AS (
  -- Newest temperature from each spot's APPROVED PRIMARY station. Reads the
  -- base tables rather than spot_conditions_live so the plan stays flat and
  -- this view keeps working if that view is later reshaped.
  SELECT sos.spot_id,
         o.water_temperature_c AS measured_c,
         o.observed_at         AS measured_at,
         st.name               AS measured_station,
         sos.distance_km       AS measured_distance_km,
         p.code                AS measured_provider,
         p.attribution         AS measured_attribution
    FROM spot_observation_stations sos
    JOIN observation_stations st ON st.id = sos.station_id AND st.active
    JOIN observation_providers p ON p.id = st.provider_id AND p.enabled
    CROSS JOIN LATERAL (
      SELECT obs.water_temperature_c, obs.observed_at
        FROM observations obs
       WHERE obs.station_id = st.id AND obs.water_temperature_c IS NOT NULL
       ORDER BY obs.observed_at DESC
       LIMIT 1
    ) o
   WHERE sos.status = 'approved' AND sos.is_primary
)
SELECT s.id AS spot_id,
       sw.swimmer_c,
       sw.swimmer_at,
       round(EXTRACT(epoch FROM now() - sw.swimmer_at) / 3600::numeric, 1) AS swimmer_age_h,
       m.model_c,
       m.model_at,
       round(EXTRACT(epoch FROM now() - m.model_at) / 3600::numeric, 1) AS model_age_h,
       CASE
         WHEN sw.swimmer_c IS NOT NULL AND m.model_c IS NOT NULL
           THEN round(abs(sw.swimmer_c - m.model_c), 1)
         ELSE NULL::numeric
       END AS delta_c,
       CASE
         WHEN sw.swimmer_at >= (now() - '24:00:00'::interval) THEN sw.swimmer_c
         WHEN me.measured_at >= (now() - '06:00:00'::interval) THEN me.measured_c
         WHEN m.model_c IS NOT NULL THEN m.model_c
         WHEN me.measured_at >= (now() - '48:00:00'::interval) THEN me.measured_c
         WHEN sw.swimmer_at >= (now() - '7 days'::interval) THEN sw.swimmer_c
         ELSE NULL::numeric
       END AS best_c,
       CASE
         WHEN sw.swimmer_at >= (now() - '24:00:00'::interval) THEN 'swimmer'::text
         WHEN me.measured_at >= (now() - '06:00:00'::interval) THEN 'measured'::text
         WHEN m.model_c IS NOT NULL THEN 'model'::text
         WHEN me.measured_at >= (now() - '48:00:00'::interval) THEN 'measured'::text
         WHEN sw.swimmer_at >= (now() - '7 days'::interval) THEN 'swimmer'::text
         ELSE NULL::text
       END AS best_source,
       CASE
         -- Two independent sources agreeing is the strongest evidence there is.
         WHEN sw.swimmer_at >= (now() - '24:00:00'::interval)
              AND m.model_c IS NOT NULL AND abs(sw.swimmer_c - m.model_c) <= 1.5 THEN 'high'::text
         WHEN sw.swimmer_at >= (now() - '24:00:00'::interval)
              AND me.measured_at >= (now() - '06:00:00'::interval)
              AND abs(sw.swimmer_c - me.measured_c) <= 1.5 THEN 'high'::text
         -- A live instrument close to the spot: high on its own. Far away it
         -- is still a real measurement, but of water that is not quite here.
         WHEN me.measured_at >= (now() - '06:00:00'::interval)
              AND me.measured_distance_km <= 5 THEN 'high'::text
         WHEN sw.swimmer_at >= (now() - '24:00:00'::interval) THEN 'medium'::text
         WHEN me.measured_at >= (now() - '48:00:00'::interval) THEN 'medium'::text
         WHEN m.model_c IS NOT NULL AND m.model_at >= (now() - '12:00:00'::interval) THEN 'medium'::text
         WHEN sw.swimmer_at >= (now() - '7 days'::interval) THEN 'low'::text
         WHEN m.model_c IS NOT NULL THEN 'low'::text
         ELSE 'none'::text
       END AS confidence,
       -- New columns go LAST: CREATE OR REPLACE VIEW may only append, never
       -- insert into the middle of an existing column list (Postgres 42P16).
       me.measured_c,
       me.measured_at,
       round(EXTRACT(epoch FROM now() - me.measured_at) / 3600::numeric, 1) AS measured_age_h,
       me.measured_station,
       me.measured_distance_km,
       me.measured_provider,
       me.measured_attribution
  FROM spots s
  LEFT JOIN swimmer sw ON sw.spot_id = s.id
  LEFT JOIN model m ON m.spot_id = s.id
  LEFT JOIN measured me ON me.spot_id = s.id
 WHERE s.active IS NOT FALSE;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- Fully reversible — this is the PREVIOUS definition, verbatim:
-- CREATE OR REPLACE VIEW spot_temp_estimate WITH (security_invoker = true) AS
-- WITH swimmer AS (
--   SELECT DISTINCT ON (temp_logs.spot_id) temp_logs.spot_id,
--          temp_logs.temp_c AS swimmer_c,
--          COALESCE(temp_logs.logged_at, temp_logs.created_at) AS swimmer_at
--     FROM temp_logs WHERE temp_logs.temp_c IS NOT NULL
--    ORDER BY temp_logs.spot_id, (COALESCE(temp_logs.logged_at, temp_logs.created_at)) DESC
-- ), model AS (
--   SELECT spot_water_latest.spot_id, spot_water_latest.sst_c AS model_c,
--          spot_water_latest.observed_at AS model_at
--     FROM spot_water_latest WHERE spot_water_latest.source = 'open_meteo'::text
-- )
-- SELECT s.id AS spot_id, sw.swimmer_c, sw.swimmer_at,
--        round(EXTRACT(epoch FROM now() - sw.swimmer_at) / 3600::numeric, 1) AS swimmer_age_h,
--        m.model_c, m.model_at,
--        round(EXTRACT(epoch FROM now() - m.model_at) / 3600::numeric, 1) AS model_age_h,
--        CASE WHEN sw.swimmer_c IS NOT NULL AND m.model_c IS NOT NULL
--             THEN round(abs(sw.swimmer_c - m.model_c), 1) ELSE NULL::numeric END AS delta_c,
--        CASE WHEN sw.swimmer_at >= (now() - '24:00:00'::interval) THEN sw.swimmer_c
--             WHEN m.model_c IS NOT NULL THEN m.model_c
--             WHEN sw.swimmer_at >= (now() - '7 days'::interval) THEN sw.swimmer_c
--             ELSE NULL::numeric END AS best_c,
--        CASE WHEN sw.swimmer_at >= (now() - '24:00:00'::interval) THEN 'swimmer'::text
--             WHEN m.model_c IS NOT NULL THEN 'model'::text
--             WHEN sw.swimmer_at >= (now() - '7 days'::interval) THEN 'swimmer'::text
--             ELSE NULL::text END AS best_source,
--        CASE WHEN sw.swimmer_at >= (now() - '24:00:00'::interval) AND m.model_c IS NOT NULL
--                  AND abs(sw.swimmer_c - m.model_c) <= 1.5 THEN 'high'::text
--             WHEN sw.swimmer_at >= (now() - '24:00:00'::interval) THEN 'medium'::text
--             WHEN m.model_c IS NOT NULL AND m.model_at >= (now() - '12:00:00'::interval) THEN 'medium'::text
--             WHEN sw.swimmer_at >= (now() - '7 days'::interval) THEN 'low'::text
--             WHEN m.model_c IS NOT NULL THEN 'low'::text
--             ELSE 'none'::text END AS confidence
--   FROM spots s
--   LEFT JOIN swimmer sw ON sw.spot_id = s.id
--   LEFT JOIN model m ON m.spot_id = s.id
--  WHERE s.active IS NOT FALSE;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT best_source, count(*) FROM spot_temp_estimate GROUP BY 1 ORDER BY 1;
--   -- expect: a new 'measured' bucket appears; 'swimmer' count unchanged
-- SELECT s.name, e.best_source, e.best_c, e.measured_c, e.measured_station,
--        e.measured_distance_km, e.confidence
--   FROM spot_temp_estimate e JOIN spots s ON s.id = e.spot_id
--  WHERE e.measured_c IS NOT NULL ORDER BY s.name;
--   -- expect: the 9 spots with an approved primary station
-- SELECT count(*) FROM spot_temp_estimate WHERE best_c IS NOT NULL;
--   -- expect: >= the count before applying (measured can only add coverage)
