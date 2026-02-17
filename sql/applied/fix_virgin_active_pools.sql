-- Fix Virgin Active pools: add missing 'code' column
-- Run this in Supabase → SQL Editor

UPDATE spots SET code = 'VA_GREENPOINT' WHERE name = 'Virgin Active Green Point';
UPDATE spots SET code = 'VA_FORESHORE' WHERE name = 'Virgin Active Foreshore';
UPDATE spots SET code = 'VA_SILO' WHERE name = 'Virgin Active Silo District (V&A)';
UPDATE spots SET code = 'VA_CLAREMONT' WHERE name = 'Virgin Active Claremont';
UPDATE spots SET code = 'VA_CENTURY' WHERE name = 'Virgin Active Century City';
UPDATE spots SET code = 'VA_TYGERVALLEY' WHERE name = 'Virgin Active Tygervalley';
UPDATE spots SET code = 'VA_TABLEVIEW' WHERE name = 'Virgin Active Table View';

-- Add Virgin Active Wembley Square
INSERT INTO spots (name, code, water_type, domain, latitude, longitude, active) VALUES
  ('Virgin Active Wembley Square', 'VA_WEMBLEY', 'POOL', 'ATLANTIC', -33.9310, 18.4130, true);
