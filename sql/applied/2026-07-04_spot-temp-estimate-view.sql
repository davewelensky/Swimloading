-- ================================================================
-- SwimLoading — Migration
-- ================================================================

-- ⚠️  SAFETY CHECK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-07-04_spot-temp-estimate-view.sql
-- ================================================================
-- Purpose:
--   Water-temp intelligence Phase 2 (#4 confidence). One reusable view that
--   blends swimmer-reported temp (temp_logs, ground truth) with modelled SST
--   (spot_water_latest, open_meteo) and returns a best estimate + confidence.
--   Read-only, non-destructive. Requested by Dave.
--
--   Confidence:
--     high   — swimmer <24h AND model present AND |swimmer-model| <= 1.5°C
--     medium — swimmer <24h (no/other model)  OR  fresh model, no recent swimmer
--     low    — only a swimmer report 24h–7d old, no fresh model
--     none   — nothing within 7 days and no model
--   Best estimate prefers a recent swimmer reading (ground truth), else model.

BEGIN;

CREATE OR REPLACE VIEW public.spot_temp_estimate
  WITH (security_invoker = true) AS
WITH swimmer AS (
  SELECT DISTINCT ON (spot_id)
         spot_id,
         temp_c                                AS swimmer_c,
         COALESCE(logged_at, created_at)       AS swimmer_at
  FROM public.temp_logs
  WHERE temp_c IS NOT NULL
  ORDER BY spot_id, COALESCE(logged_at, created_at) DESC
),
model AS (
  SELECT spot_id, sst_c AS model_c, observed_at AS model_at
  FROM public.spot_water_latest
  WHERE source = 'open_meteo'
)
SELECT
  s.id AS spot_id,
  sw.swimmer_c,
  sw.swimmer_at,
  ROUND((EXTRACT(EPOCH FROM (now() - sw.swimmer_at)) / 3600)::numeric, 1) AS swimmer_age_h,
  m.model_c,
  m.model_at,
  ROUND((EXTRACT(EPOCH FROM (now() - m.model_at)) / 3600)::numeric, 1)    AS model_age_h,
  CASE WHEN sw.swimmer_c IS NOT NULL AND m.model_c IS NOT NULL
       THEN ROUND(ABS(sw.swimmer_c - m.model_c), 1) END                    AS delta_c,

  -- best estimate
  CASE
    WHEN sw.swimmer_at >= now() - interval '24 hours' THEN sw.swimmer_c
    WHEN m.model_c IS NOT NULL                        THEN m.model_c
    WHEN sw.swimmer_at >= now() - interval '7 days'   THEN sw.swimmer_c
    ELSE NULL
  END AS best_c,
  CASE
    WHEN sw.swimmer_at >= now() - interval '24 hours' THEN 'swimmer'
    WHEN m.model_c IS NOT NULL                        THEN 'model'
    WHEN sw.swimmer_at >= now() - interval '7 days'   THEN 'swimmer'
    ELSE NULL
  END AS best_source,

  -- confidence
  CASE
    WHEN sw.swimmer_at >= now() - interval '24 hours'
         AND m.model_c IS NOT NULL
         AND ABS(sw.swimmer_c - m.model_c) <= 1.5           THEN 'high'
    WHEN sw.swimmer_at >= now() - interval '24 hours'       THEN 'medium'
    WHEN m.model_c IS NOT NULL
         AND m.model_at >= now() - interval '12 hours'      THEN 'medium'
    WHEN sw.swimmer_at >= now() - interval '7 days'         THEN 'low'
    WHEN m.model_c IS NOT NULL                              THEN 'low'
    ELSE 'none'
  END AS confidence
FROM public.spots s
LEFT JOIN swimmer sw ON sw.spot_id = s.id
LEFT JOIN model   m  ON m.spot_id  = s.id
WHERE s.active IS NOT FALSE;

GRANT SELECT ON public.spot_temp_estimate TO anon, authenticated;

COMMIT;

-- VERIFY (read-only):
--   SELECT confidence, count(*) FROM spot_temp_estimate GROUP BY confidence ORDER BY 1;
--   SELECT * FROM spot_temp_estimate WHERE best_c IS NOT NULL LIMIT 5;
-- ROLLBACK: DROP VIEW IF EXISTS public.spot_temp_estimate;
