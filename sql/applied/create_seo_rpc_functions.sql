-- SEO API functions — run once in Supabase SQL editor before deploying the SEO layer.
-- These are read-only, security-definer functions callable with the anon key.

-- 1. Seasonal stats for a single spot (min, max, avg temp, total log count)
CREATE OR REPLACE FUNCTION seo_spot_seasonal_avg(p_spot_id uuid)
RETURNS TABLE(min_temp numeric, max_temp numeric, avg_temp numeric, total_logs bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    ROUND(MIN(temp_c)::numeric, 1)  AS min_temp,
    ROUND(MAX(temp_c)::numeric, 1)  AS max_temp,
    ROUND(AVG(temp_c)::numeric, 1)  AS avg_temp,
    COUNT(*)                         AS total_logs
  FROM temp_logs
  WHERE spot_id = p_spot_id
    AND temp_c IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION seo_spot_seasonal_avg(uuid) TO anon, authenticated;

-- 2. Regional spots with aggregate data, ordered by most-logged first
CREATE OR REPLACE FUNCTION seo_regional_spots(p_domains text[])
RETURNS TABLE(
  id          uuid,
  name        text,
  domain      text,
  area        text,
  water_type  text,
  brand       text,
  code        text,
  latitude    float8,
  longitude   float8,
  last_logged timestamptz,
  avg_temp    numeric,
  total_logs  bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    s.id,
    s.name,
    s.domain,
    s.area,
    s.water_type,
    s.brand,
    s.code,
    s.latitude,
    s.longitude,
    MAX(COALESCE(tl.logged_at, tl.created_at))  AS last_logged,
    ROUND(AVG(tl.temp_c)::numeric, 1)           AS avg_temp,
    COUNT(tl.id)                                 AS total_logs
  FROM spots s
  LEFT JOIN temp_logs tl ON tl.spot_id = s.id AND tl.temp_c IS NOT NULL
  WHERE s.domain = ANY(p_domains)
    AND s.active = true
  GROUP BY s.id, s.name, s.domain, s.area, s.water_type, s.brand, s.code, s.latitude, s.longitude
  ORDER BY total_logs DESC, s.name ASC;
$$;

GRANT EXECUTE ON FUNCTION seo_regional_spots(text[]) TO anon, authenticated;
