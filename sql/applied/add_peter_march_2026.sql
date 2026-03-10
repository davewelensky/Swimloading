-- ══════════════════════════════════════════════════════════════════════════════
-- Peter Emslie — False Bay crossing, 11 Mar 2026
-- Pool background: 50m pool, 1:29/100m sustained (10km Garmin Swim 2)
-- OW calibration: Langebaan Express 12km — Carina wetsuit 2:44 (4.39 km/h), Pete skins 2:47 (4.31 km/h)
--   IMPORTANT: Carina suffered SIPE at Langebaan — her healthy wetsuit pace would have been faster than 2:44
--   Pete healthy skins 4.31 km/h vs Carina impaired wetsuit 4.39 km/h → true gap even wider in Pete's favour
--   Pete is faster than Carina skins at race distance. Sustained False Bay pace est: 3.5–3.7 km/h
--   Projected crossing: ~9:00–10:10 depending on current assist
--
-- ⚠️  SIPE RISK: Miller's Point start ~16°C cold water + hard early effort = SIPE trigger zone
--   Carina has prior SIPE history at Langebaan. Pete's crew must watch for:
--   coughing, breathlessness, pink frothy sputum in first 30–60 min. Slow start protocol advised.
-- Fill in: duration, conditions, water_temp_c after swim completes
-- ══════════════════════════════════════════════════════════════════════════════

-- STEP 1: Insert swimmer (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM historical_swimmers WHERE name_normalized = 'peteremslie' AND gender = 'M') THEN
    INSERT INTO historical_swimmers (display_name, name_normalized, gender, country)
    VALUES ('Peter Emslie', 'peteremslie', 'M', 'ZA');
    RAISE NOTICE 'Peter Emslie inserted into historical_swimmers';
  ELSE
    RAISE NOTICE 'Peter Emslie already exists — skipping';
  END IF;
END $$;

-- STEP 2: Insert swim — UPDATE duration/conditions/water_temp_c after swim completes
-- conditions options: 'good' | 'bumpy' | 'choppy' | 'misty' | 'big_swell' | 'rain'
INSERT INTO historical_swims (
  source_row_num, swim_date, swimmer_id, route_id,
  conditions, water_temp_c, duration, category, is_relay, source
)
SELECT
  40000002,
  '2026-03-11',
  hs.id,
  '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- False Bay W→E route
  'bumpy',          -- ← UPDATE after swim
  18.0,             -- ← UPDATE after swim (check community logs)
  INTERVAL '10 hours 30 minutes',  -- ← UPDATE after swim
  'skins',
  false,
  'garmin_verified'
FROM historical_swimmers hs
WHERE hs.name_normalized = 'peteremslie' AND hs.gender = 'M'
ON CONFLICT (source_row_num, source) DO NOTHING
RETURNING id, swim_date, duration, conditions, water_temp_c;

-- STEP 3: Verify
SELECT
  hsw.display_name,
  hs.swim_date,
  TO_CHAR(hs.duration, 'HH24:MI:SS') AS time,
  hs.water_temp_c,
  hs.conditions,
  hs.source
FROM historical_swims hs
JOIN historical_swimmers hsw ON hs.swimmer_id = hsw.id
WHERE hs.source = 'garmin_verified'
ORDER BY hs.swim_date DESC;
