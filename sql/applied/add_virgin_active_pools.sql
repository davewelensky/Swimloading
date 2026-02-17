-- ============================================
-- Add Virgin Active Pools to spots table
-- Run this in Supabase → SQL Editor
-- ============================================

INSERT INTO spots (name, water_type, domain, latitude, longitude, active) VALUES
  ('Virgin Active Green Point', 'POOL', 'ATLANTIC', -33.9035, 18.4105, true),
  ('Virgin Active Foreshore', 'POOL', 'ATLANTIC', -33.9210, 18.4260, true),
  ('Virgin Active Silo District (V&A)', 'POOL', 'ATLANTIC', -33.9080, 18.4180, true),
  ('Virgin Active Claremont', 'POOL', 'FALSE_BAY', -33.9830, 18.4640, true),
  ('Virgin Active Century City', 'POOL', 'INLAND', -33.8890, 18.5100, true),
  ('Virgin Active Tygervalley', 'POOL', 'INLAND', -33.8710, 18.6340, true),
  ('Virgin Active Table View', 'POOL', 'WEST_COAST', -33.8090, 18.4890, true);
