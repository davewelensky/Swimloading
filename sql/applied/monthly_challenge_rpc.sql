-- Monthly Temperature Challenge leaderboard
-- Returns top 10 temp loggers for a given calendar month window.
-- Called from JS: supabaseClient.rpc('get_monthly_temp_leaders', { p_month_start, p_month_end })
--
-- Run once in Supabase SQL Editor to create the function.

CREATE OR REPLACE FUNCTION get_monthly_temp_leaders(
  p_month_start TIMESTAMPTZ,
  p_month_end   TIMESTAMPTZ
)
RETURNS TABLE(user_id UUID, display_name TEXT, avatar_url TEXT, log_count BIGINT)
LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT
    tl.user_id,
    p.display_name,
    p.avatar_url,
    COUNT(*) AS log_count
  FROM   temp_logs tl
  JOIN   profiles  p ON p.id = tl.user_id
  WHERE  tl.created_at >= p_month_start
    AND  tl.created_at <  p_month_end
  GROUP  BY tl.user_id, p.display_name, p.avatar_url
  ORDER  BY log_count DESC
  LIMIT  10;
$$;
