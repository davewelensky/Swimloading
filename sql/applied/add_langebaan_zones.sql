-- Rename existing Langebaan to Pearly's (main beach, opposite the island)
UPDATE spots SET name = 'Langebaan — Pearly''s', code = 'LB_PEARLYS' WHERE id = '59270680-5da5-4948-9f53-58c09ee03c0e';

-- Add Langebaan zones
INSERT INTO spots (name, code, water_type, domain, latitude, longitude, active) VALUES
  ('Langebaan — The Island', 'LB_ISLAND', 'LAGOON', 'WEST_COAST', -33.1150, 18.0580, true),
  ('Langebaan — Channel', 'LB_CHANNEL', 'LAGOON', 'WEST_COAST', -33.1000, 18.0700, true),
  ('Langebaan — Mykonos', 'LB_MYKONOS', 'LAGOON', 'WEST_COAST', -33.0880, 18.0440, true),
  ('Langebaan — Kraalbaai / Preekstoel', 'LB_PREEKSTOEL', 'LAGOON', 'WEST_COAST', -33.1380, 18.0900, true);
