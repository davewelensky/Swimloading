-- Monthly Temperature Challenge leaderboard — Points-based scoring (v3)
-- Scoring:
--   10 pts per log × multiplier
--   +10 pts per unique spot per day × multiplier
--   +30 pts for first person ever to log a brand-new spot (flat, no multiplier)
-- April 2026 multiplier: 2x for logs outside Cape Town (ATLANTIC / FALSE_BAY / WEST_COAST)
-- Called from JS: supabaseClient.rpc('get_monthly_temp_leaders', { p_month_start, p_month_end })
--
-- DROP required because signature/return type must match exactly.

DROP FUNCTION IF EXISTS get_monthly_temp_leaders(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION get_monthly_temp_leaders(
  p_month_start TIMESTAMPTZ,
  p_month_end   TIMESTAMPTZ
)
RETURNS TABLE(
  user_id       UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  log_count     BIGINT,
  total_points  BIGINT
)
LANGUAGE SQL SECURITY DEFINER AS $$

  WITH

  -- ── 1. All logs this month, with domain + April multiplier ─────────────────
  month_logs AS (
    SELECT
      tl.user_id,
      tl.spot_id,
      DATE(COALESCE(tl.logged_at, tl.created_at))  AS log_day,
      CASE
        WHEN DATE_TRUNC('month', COALESCE(tl.logged_at, tl.created_at)) = '2026-04-01'
         AND COALESCE(s.domain, 'ATLANTIC') NOT IN ('ATLANTIC', 'FALSE_BAY', 'WEST_COAST')
        THEN 2 ELSE 1
      END AS multiplier
    FROM temp_logs tl
    LEFT JOIN spots s ON s.id = tl.spot_id
    WHERE tl.created_at >= p_month_start
      AND tl.created_at <  p_month_end
  ),

  -- ── 2. Raw log count (unaffected by multiplier — shown as "X logs") ────────
  user_log_count AS (
    SELECT user_id, COUNT(*) AS log_count
    FROM   month_logs
    GROUP  BY user_id
  ),

  -- ── 3. Base points: 10 × multiplier per log, per day ──────────────────────
  daily_base AS (
    SELECT user_id, log_day, SUM(multiplier * 10) AS base_pts
    FROM   month_logs
    GROUP  BY user_id, log_day
  ),

  -- ── 4. Spot bonus: 10 × multiplier per unique spot per day ────────────────
  --    Use MAX(multiplier) per spot in case of mixed domains in one day
  daily_spot_bonus AS (
    SELECT user_id, log_day, SUM(spot_mult * 10) AS spot_pts
    FROM (
      SELECT user_id, log_day, spot_id, MAX(multiplier) AS spot_mult
      FROM   month_logs
      GROUP  BY user_id, log_day, spot_id
    ) x
    GROUP BY user_id, log_day
  ),

  -- ── 5. Combined log-based points ──────────────────────────────────────────
  user_log_points AS (
    SELECT b.user_id,
           SUM(b.base_pts + s.spot_pts) AS log_points
    FROM       daily_base        b
    JOIN       daily_spot_bonus  s USING (user_id, log_day)
    GROUP BY   b.user_id
  ),

  -- ── 6. First-ever logger per spot (all-time) ──────────────────────────────
  first_spot_logger AS (
    SELECT DISTINCT ON (spot_id)
      spot_id,
      user_id
    FROM  temp_logs
    ORDER BY spot_id, created_at ASC
  ),

  -- ── 7. +30 bonus for spots whose first-ever log falls in this month ────────
  new_spot_bonus AS (
    SELECT fsl.user_id, COUNT(*) * 30 AS bonus_pts
    FROM   first_spot_logger fsl
    JOIN   temp_logs tl
           ON  tl.spot_id  = fsl.spot_id
           AND tl.user_id  = fsl.user_id
           AND tl.created_at >= p_month_start
           AND tl.created_at <  p_month_end
    GROUP  BY fsl.user_id
  )

  SELECT
    ulp.user_id,
    p.display_name,
    p.avatar_url,
    ulc.log_count::BIGINT,
    (ulp.log_points + COALESCE(nsb.bonus_pts, 0))::BIGINT AS total_points
  FROM       user_log_points  ulp
  JOIN       user_log_count   ulc USING (user_id)
  JOIN       profiles         p   ON p.id = ulp.user_id
  LEFT JOIN  new_spot_bonus   nsb ON nsb.user_id = ulp.user_id
  ORDER BY   total_points DESC
  LIMIT  20;

$$;
