-- Add multi-distance support for official race events
-- Run in Supabase → SQL Editor

ALTER TABLE swim_events
    ADD COLUMN IF NOT EXISTS distances_km numeric[];

-- distances_km stores multiple race distances e.g. {1, 2.5, 5, 7.5, 10}
-- group_swim events continue to use distance_km (single value)
-- official_race events use distances_km array
