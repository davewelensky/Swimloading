-- Add Gqeberha and St Francis Bay to Eastern Cape domain
-- Constraint already updated in add_eastern_cape_kenton.sql
-- Run in Supabase SQL Editor

INSERT INTO spots (name, code, water_type, domain, latitude, longitude, active)
VALUES
  ('Gqeberha',      'GQEBERHA',       'OCEAN', 'EASTERN_CAPE', -33.862485401762584, 25.640723199215785, true),
  ('St Francis Bay', 'ST_FRANCIS_BAY', 'OCEAN', 'EASTERN_CAPE', -34.150195271860966, 24.840477780500578, true);
