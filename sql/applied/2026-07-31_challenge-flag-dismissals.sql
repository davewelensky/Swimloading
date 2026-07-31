-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-07-31_challenge-flag-dismissals.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Let an admin dismiss a single anti-cheat flag (temp outlier or impossible
--   travel) without voiding the log, so reviewed-and-cleared flags stop
--   resurfacing in the admin.html anti-cheat panel — replaces the "hide
--   anything older than a week" idea, which would have hidden un-reviewed
--   flags right before the July draw.

-- Requested by:
--   Dave, 31 Jul 2026 (July challenge draw day)

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables WHERE table_name = 'challenge_flag_dismissals';  -- expect: 0

-- ----------------------------------------------------------------
-- BACKUP — not applicable, purely additive (new table, new function,
-- CREATE OR REPLACE on two existing views — no data is dropped or altered).
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.challenge_flag_dismissals (
  log_id       uuid PRIMARY KEY,
  flag_type    text NOT NULL CHECK (flag_type IN ('temp_outlier','impossible_travel')),
  dismissed_by uuid,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  note         text
);

COMMENT ON TABLE public.challenge_flag_dismissals IS
  'Per-log dismissals for the admin.html anti-cheat panel. A dismissed flag stays dismissed for that log_id even if the underlying temp_log/travel pattern still matches the outlier query — voiding is separate and still removes the log entirely.';

ALTER TABLE public.challenge_flag_dismissals ENABLE ROW LEVEL SECURITY;
-- No policies: only reachable via the SECURITY DEFINER RPC below (service role
-- bypasses RLS for admin.html direct reads if ever needed later).

CREATE OR REPLACE FUNCTION public.dismiss_challenge_flag(p_log_id uuid, p_flag_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM june_challenge_config
                 WHERE id = 1 AND tester_ids @> ARRAY[auth.uid()]::uuid[]) THEN
    RAISE EXCEPTION 'Not authorised to dismiss flags';
  END IF;

  INSERT INTO challenge_flag_dismissals (log_id, flag_type, dismissed_by)
  VALUES (p_log_id, p_flag_type, auth.uid())
  ON CONFLICT (log_id) DO NOTHING;

  RETURN FOUND;
END;
$function$;

-- Re-point both anomaly views to exclude dismissed log_ids.
CREATE OR REPLACE VIEW public.v_challenge_temp_outliers AS
WITH cfg AS (
  SELECT launch_date, end_date FROM june_challenge_config WHERE id = 1
), target AS (
  SELECT t.id AS log_id, t.user_id, t.spot_id, t.temp_c, t.created_at,
         s.name AS spot, p.display_name
  FROM temp_logs t
  JOIN spots s ON s.id = t.spot_id
  LEFT JOIN profiles p ON p.id = t.user_id
  CROSS JOIN cfg
  WHERE t.created_at >= (cfg.launch_date::timestamp AT TIME ZONE 'Africa/Johannesburg')
    AND t.created_at < ((cfg.end_date + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg')
    AND t.temp_c IS NOT NULL
    AND EXISTS (SELECT 1 FROM june_challenge_events e WHERE e.ref_id = t.id::text AND e.action_type = 'temp_log')
    AND NOT EXISTS (SELECT 1 FROM challenge_flag_dismissals d WHERE d.log_id = t.id AND d.flag_type = 'temp_outlier')
), baseline AS (
  SELECT tg.log_id,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY b.temp_c::float) AS med,
         count(*) AS n
  FROM target tg
  JOIN temp_logs b ON b.spot_id = tg.spot_id
                   AND b.id <> tg.log_id
                   AND b.temp_c IS NOT NULL
                   AND b.created_at >= tg.created_at - interval '45 days'
                   AND b.created_at <= tg.created_at + interval '45 days'
  GROUP BY tg.log_id
)
SELECT tg.log_id, tg.user_id, tg.display_name, tg.spot, tg.temp_c, tg.created_at,
       round(b.med::numeric, 1) AS spot_median,
       b.n AS baseline_logs,
       round((tg.temp_c::float - b.med)::numeric, 1) AS deviation
FROM target tg
JOIN baseline b ON b.log_id = tg.log_id
WHERE b.n >= 5 AND abs(tg.temp_c::float - b.med) >= 4
ORDER BY abs(tg.temp_c::float - b.med) DESC;

CREATE OR REPLACE VIEW public.v_challenge_travel_anomalies AS
WITH cfg AS (
  SELECT launch_date, end_date FROM june_challenge_config WHERE id = 1
), logs AS (
  SELECT t.user_id, t.id AS log_id, t.created_at, t.temp_c, s.name AS spot,
         s.latitude AS lat, s.longitude AS lng, s.country_code, p.display_name
  FROM temp_logs t
  JOIN spots s ON s.id = t.spot_id
  LEFT JOIN profiles p ON p.id = t.user_id
  CROSS JOIN cfg
  WHERE t.created_at >= (cfg.launch_date::timestamp AT TIME ZONE 'Africa/Johannesburg')
    AND t.created_at < ((cfg.end_date + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg')
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND EXISTS (SELECT 1 FROM june_challenge_events e WHERE e.ref_id = t.id::text AND e.action_type = 'temp_log')
    AND NOT EXISTS (SELECT 1 FROM challenge_flag_dismissals d WHERE d.log_id = t.id AND d.flag_type = 'impossible_travel')
), seq AS (
  SELECT logs.*,
         lag(lat) OVER w AS plat, lag(lng) OVER w AS plng,
         lag(created_at) OVER w AS pt, lag(spot) OVER w AS pspot
  FROM logs
  WINDOW w AS (PARTITION BY user_id ORDER BY created_at)
), calc AS (
  SELECT seq.*,
         6371 * acos(LEAST(1, GREATEST(-1,
           cos(radians(plat)) * cos(radians(lat)) * cos(radians(lng) - radians(plng))
           + sin(radians(plat)) * sin(radians(lat))))) AS km,
         EXTRACT(epoch FROM (created_at - pt)) / 60.0 AS mins
  FROM seq
  WHERE pt IS NOT NULL
)
SELECT log_id, user_id, display_name, spot, pspot AS prev_spot, temp_c, created_at,
       round(km::numeric, 1) AS km_from_prev,
       round(mins, 0) AS mins_gap,
       round((km / NULLIF(mins / 60.0, 0))::numeric, 0) AS implied_kmh
FROM calc
WHERE km > 10 AND (km / NULLIF(mins / 60.0, 0)) > 120
ORDER BY round((km / NULLIF(mins / 60.0, 0))::numeric, 0) DESC;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP FUNCTION public.dismiss_challenge_flag(uuid, text);
-- DROP TABLE public.challenge_flag_dismissals;
-- then re-run the two CREATE OR REPLACE VIEW statements from
-- sql/applied/june_challenge_v2_functions.sql (pre-dismissal versions)
-- to restore the views without the dismissal filter.

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT count(*) FROM challenge_flag_dismissals;  -- expect: 0 (nothing dismissed yet)
-- SELECT dismiss_challenge_flag('<some log_id>', 'temp_outlier');  -- run as a tester_ids user; expect: true
-- SELECT * FROM v_challenge_temp_outliers WHERE log_id = '<some log_id>';  -- expect: 0 rows after dismissal
