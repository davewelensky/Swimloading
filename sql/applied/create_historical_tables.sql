-- ============================================
-- Historical Swim Data Tables
-- Big Bay Events data 2014-2024 (2,685 swims)
-- Run in Supabase SQL Editor in order
-- ============================================


-- -----------------------------------------------
-- 1. HISTORICAL ROUTES
-- Normalized route names with metadata
-- -----------------------------------------------

CREATE TABLE IF NOT EXISTS historical_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    name_normalized TEXT NOT NULL,
    distance_km NUMERIC(5,1),
    water_body TEXT CHECK (water_body IN ('atlantic', 'false_bay', 'west_coast', 'mixed')),
    start_location TEXT,
    end_location TEXT,
    start_lat NUMERIC(9,6),
    start_lng NUMERIC(9,6),
    end_lat NUMERIC(9,6),
    end_lng NUMERIC(9,6),
    is_crossing BOOLEAN DEFAULT false,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historical_routes_name_normalized
    ON historical_routes(name_normalized);

ALTER TABLE historical_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view historical routes" ON historical_routes;
CREATE POLICY "Authenticated users can view historical routes"
    ON historical_routes FOR SELECT
    USING (auth.role() = 'authenticated');


-- -----------------------------------------------
-- 2. HISTORICAL SWIMMERS
-- Normalized swimmer profiles (no raw PII stored)
-- -----------------------------------------------

CREATE TABLE IF NOT EXISTS historical_swimmers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    gender TEXT CHECK (gender IN ('M', 'F')),
    city TEXT,
    country TEXT,
    email_hash TEXT,            -- SHA-256 of email, for "claim your history" linking only
    linked_profile_id UUID REFERENCES profiles(id),
    is_group BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historical_swimmers_lookup
    ON historical_swimmers(name_normalized, gender);
CREATE INDEX IF NOT EXISTS idx_historical_swimmers_email_hash
    ON historical_swimmers(email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_historical_swimmers_linked
    ON historical_swimmers(linked_profile_id) WHERE linked_profile_id IS NOT NULL;

ALTER TABLE historical_swimmers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view historical swimmers" ON historical_swimmers;
CREATE POLICY "Authenticated users can view historical swimmers"
    ON historical_swimmers FOR SELECT
    USING (auth.role() = 'authenticated');


-- -----------------------------------------------
-- 3. HISTORICAL SWIMS
-- Main fact table — one row per swimmer per swim
-- -----------------------------------------------

CREATE TABLE IF NOT EXISTS historical_swims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_row_num INTEGER NOT NULL,
    swim_date DATE NOT NULL,
    swimmer_id UUID NOT NULL REFERENCES historical_swimmers(id),
    route_id UUID NOT NULL REFERENCES historical_routes(id),
    conditions TEXT CHECK (conditions IN (
        'good', 'bumpy', 'choppy', 'misty', 'big_swell', 'rain', 'all_seasons'
    )),
    distance_km NUMERIC(5,1),
    water_temp_c NUMERIC(4,1),
    duration INTERVAL,
    category TEXT NOT NULL CHECK (category IN ('skins', 'wetsuit', 'relay', 'assisted')),
    stroke TEXT CHECK (stroke IN ('freestyle', 'butterfly', 'breaststroke')),
    is_island_escape BOOLEAN DEFAULT false,
    is_relay BOOLEAN DEFAULT false,
    is_jammers BOOLEAN DEFAULT false,
    source TEXT DEFAULT 'big_bay_events',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_row_num, source)
);

CREATE INDEX IF NOT EXISTS idx_historical_swims_date
    ON historical_swims(swim_date);
CREATE INDEX IF NOT EXISTS idx_historical_swims_route
    ON historical_swims(route_id);
CREATE INDEX IF NOT EXISTS idx_historical_swims_swimmer
    ON historical_swims(swimmer_id);
CREATE INDEX IF NOT EXISTS idx_historical_swims_temp
    ON historical_swims(water_temp_c);
CREATE INDEX IF NOT EXISTS idx_historical_swims_route_date
    ON historical_swims(route_id, swim_date);
CREATE INDEX IF NOT EXISTS idx_historical_swims_category
    ON historical_swims(category);
CREATE INDEX IF NOT EXISTS idx_historical_swims_crossing_analysis
    ON historical_swims(route_id, category, water_temp_c, swim_date);

ALTER TABLE historical_swims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view historical swims" ON historical_swims;
CREATE POLICY "Authenticated users can view historical swims"
    ON historical_swims FOR SELECT
    USING (auth.role() = 'authenticated');


-- -----------------------------------------------
-- 4. HISTORICAL WEATHER
-- OpenMeteo backfill — one row per date per location
-- -----------------------------------------------

CREATE TABLE IF NOT EXISTS historical_weather (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    observation_date DATE NOT NULL,
    latitude NUMERIC(9,6) NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    air_temp_max_c NUMERIC(4,1),
    air_temp_min_c NUMERIC(4,1),
    air_temp_mean_c NUMERIC(4,1),
    wind_speed_max_kmh NUMERIC(5,1),
    wind_speed_mean_kmh NUMERIC(5,1),
    wind_direction_dominant INTEGER,
    precipitation_mm NUMERIC(5,1),
    wave_height_max_m NUMERIC(4,2),
    wave_period_max_s NUMERIC(4,1),
    swell_wave_height_m NUMERIC(4,2),
    swell_wave_direction INTEGER,
    swell_wave_period_s NUMERIC(4,1),
    sea_surface_temp_c NUMERIC(4,1),
    source TEXT DEFAULT 'open_meteo',
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(observation_date, latitude, longitude)
);

CREATE INDEX IF NOT EXISTS idx_historical_weather_date
    ON historical_weather(observation_date);
CREATE INDEX IF NOT EXISTS idx_historical_weather_location
    ON historical_weather(latitude, longitude);

ALTER TABLE historical_weather ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view historical weather" ON historical_weather;
CREATE POLICY "Authenticated users can view historical weather"
    ON historical_weather FOR SELECT
    USING (auth.role() = 'authenticated');


-- -----------------------------------------------
-- 5. USEFUL VIEW — False Bay crossings
-- -----------------------------------------------

CREATE OR REPLACE VIEW v_false_bay_crossings AS
SELECT
    hs.swim_date,
    EXTRACT(MONTH FROM hs.swim_date)::INTEGER AS month,
    EXTRACT(YEAR FROM hs.swim_date)::INTEGER AS year,
    hsw.display_name,
    hsw.gender,
    hs.water_temp_c,
    hs.duration,
    TO_CHAR(hs.duration, 'HH24:MI:SS') AS duration_formatted,
    hs.conditions,
    hs.category,
    hr.name AS route_name,
    CASE WHEN hr.name LIKE '%solo%' THEN 'solo' ELSE 'relay' END AS swim_type
FROM historical_swims hs
JOIN historical_swimmers hsw ON hs.swimmer_id = hsw.id
JOIN historical_routes hr ON hs.route_id = hr.id
WHERE hr.name LIKE 'False Bay%'
ORDER BY hs.duration;
