-- Run these one at a time in Supabase SQL Editor to diagnose

-- 1. Check spots table structure
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'spots' ORDER BY ordinal_position;

-- 2. Check the Virgin Active spots we just added
SELECT * FROM spots WHERE name LIKE 'Virgin%';

-- 3. Check if latest_spot_temps is a view or materialized view
SELECT table_name, table_type FROM information_schema.tables
WHERE table_name = 'latest_spot_temps';

-- 4. Check what latest_spot_temps returns for pools
SELECT * FROM latest_spot_temps WHERE water_type = 'POOL';

-- 5. Check if there are any temp_logs for Foreshore
SELECT tl.*, s.name as spot_name FROM temp_logs tl
JOIN spots s ON s.id = tl.spot_id
WHERE s.name LIKE '%Foreshore%'
ORDER BY tl.created_at DESC LIMIT 5;
