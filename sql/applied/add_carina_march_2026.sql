-- ============================================
-- Carina Bruwer — False Bay W→E Crossing
-- 06 March 2026 · 34km · skins · solo
-- 9:48 elapsed · conditions: rough (1.6m+ waves, cold, deteriorating)
-- Garmin-verified (GPS laps 1-65 sum = 9:50, matches confirmed 9:48)
-- Previous crossing: E→W direction, ~2006 (20 years prior)
-- ============================================

-- STEP 1: Add Carina Bruwer if not already present
-- Uses DO block so you see a NOTICE either way instead of silent "0 rows affected"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM historical_swimmers
    WHERE name_normalized = 'carinabruwer' AND gender = 'F'
  ) THEN
    INSERT INTO historical_swimmers (display_name, name_normalized, gender, country)
    VALUES ('Carina Bruwer', 'carinabruwer', 'F', 'ZA');
    RAISE NOTICE 'Carina Bruwer inserted into historical_swimmers';
  ELSE
    RAISE NOTICE 'Carina Bruwer already exists — skipping insert';
  END IF;
END $$;

-- STEP 2: Insert the swim
-- Route: False Bay W→E solo (Miller's Point → Gordon's Bay)
-- Duration: 9h 48m (06:42 start · 16:30 finish · verified by crew Garmin)
-- Conditions: Bumpy from 45 min, worsening to rough (1.6m+ waves) by second half,
--             cold throughout, chaotic at the finish landing
-- Water temp: 19°C avg (18°C min) per Garmin sensor
INSERT INTO historical_swims (
    source_row_num,
    swim_date,
    swimmer_id,
    route_id,
    conditions,
    water_temp_c,
    duration,
    category,
    is_relay,
    source
)
SELECT
    40000001,
    '2026-03-06',
    hs.id,
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- W→E solo
    'big_swell',  -- bumpy from 45min, 1.6m+ waves past halfway, brutal finish at rocks
    19.0,
    INTERVAL '9 hours 48 minutes',
    'skins',
    false,
    'garmin_verified'
FROM historical_swimmers hs
WHERE hs.name_normalized = 'carinabruwer'
  AND hs.gender = 'F'
ON CONFLICT (source_row_num, source) DO NOTHING;

-- STEP 3: Verify
SELECT
    hsw.display_name,
    hs.swim_date,
    TO_CHAR(hs.duration, 'HH24:MI:SS') AS time,
    hs.distance_km,
    hs.water_temp_c,
    hs.conditions,
    hs.category,
    hs.source
FROM historical_swims hs
JOIN historical_swimmers hsw ON hs.swimmer_id = hsw.id
WHERE hs.source = 'garmin_verified'
ORDER BY hs.swim_date DESC;
