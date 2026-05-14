-- ============================================================
-- Add USA domain + San Francisco spots
-- Requested by Cameron Bellamy — San Francisco Bay area
-- Run once in Supabase → SQL Editor
-- ============================================================

-- 1. Add USA domain
INSERT INTO domains (code, display_name, is_coastal, sort_order)
VALUES ('USA', 'United States', true, 130);

-- 2. Ensure USA exists in countries table
INSERT INTO countries (iso_code, name, is_domestic, continent)
VALUES ('US', 'United States', false, 'North America')
ON CONFLICT (iso_code) DO NOTHING;

-- 3. Aquatic Park — the heart of SF open water swimming
--    Home of the South End Rowing Club & Dolphin Club
--    Sheltered bay cove, year-round OW community
INSERT INTO spots (name, code, water_type, domain, latitude, longitude, area, country_code, active)
VALUES (
    'Aquatic Park, San Francisco',
    'SF_AQUATIC_PARK',
    'OCEAN',
    'USA',
    37.8074,
    -122.4230,
    'SAN_FRANCISCO',
    'US',
    true
);

-- 4. Ocean Beach — Pacific Ocean side, exposed surf beach
--    Strong rip currents — advanced swimmers only
INSERT INTO spots (name, code, water_type, domain, latitude, longitude, area, country_code, active)
VALUES (
    'Ocean Beach, San Francisco',
    'SF_OCEAN_BEACH',
    'OCEAN',
    'USA',
    37.7693,
    -122.5107,
    'SAN_FRANCISCO',
    'US',
    true
);
