-- Monthly Temperature Challenge leaderboard — Points-based scoring (v2)
-- Scoring: 10 pts per log + 10 pts bonus per additional unique spot logged same day.
-- Date bucketing uses COALESCE(logged_at, created_at) for backdating support.
-- Called from JS: supabaseClient.rpc('get_monthly_temp_leaders', { p_month_start, p_month_end })
--
-- Run in Supabase SQL Editor to replace the function.

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
  WITH daily_stats AS (
    -- Group each user's logs by calendar day (using logged_at for backdating support)
    SELECT
      tl.user_id,
      DATE(COALESCE(tl.logged_at, tl.created_at)) AS log_day,
      COUNT(*)                                     AS logs_that_day,
      COUNT(DISTINCT tl.spot_id)                   AS unique_spots_that_day
    FROM   temp_logs tl
    WHERE  tl.created_at >= p_month_start
      AND  tl.created_at <  p_month_end
    GROUP  BY tl.user_id, DATE(COALESCE(tl.logged_at, tl.created_at))
  ),
  user_totals AS (
    -- Roll up across all days: 10 pts per log + 10 pts bonus per additional unique spot per day
    SELECT
      user_id,
      SUM(logs_that_day)                                              AS log_count,
      SUM(
        (logs_that_day * 10)
        + (GREATEST(unique_spots_that_day - 1, 0) * 10)
      )                                                               AS total_points
    FROM   daily_stats
    GROUP  BY user_id
  )
  SELECT
    ut.user_id,
    p.display_name,
    p.avatar_url,
    ut.log_count,
    ut.total_points
  FROM   user_totals ut
  JOIN   profiles    p ON p.id = ut.user_id
  ORDER  BY ut.total_points DESC
  LIMIT  20;
$$;
