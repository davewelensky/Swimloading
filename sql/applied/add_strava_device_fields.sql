-- Add device/sensor fields to strava_imports
-- Applied: 2026-05-14
ALTER TABLE strava_imports ADD COLUMN IF NOT EXISTS average_temp integer;
ALTER TABLE strava_imports ADD COLUMN IF NOT EXISTS device_name text;
ALTER TABLE strava_imports ADD COLUMN IF NOT EXISTS average_heartrate numeric;
