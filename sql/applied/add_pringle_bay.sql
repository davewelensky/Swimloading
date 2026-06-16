-- ============================================================
-- Add Pringle Bay
-- Overberg region, Western Cape — False Bay coast near Rooi-Els
-- Run once in Supabase → SQL Editor
-- ============================================================

-- Coordinates: 34°22'S 18°49'E → -34.3667, 18.8167
-- Domain: FALSE_BAY (Pringle Bay is on the False Bay coastline,
--         south of Rooi-Els, east of Gordon's Bay)
INSERT INTO spots (name, water_type, domain, latitude, longitude, active)
VALUES ('Pringle Bay', 'OCEAN', 'FALSE_BAY', -34.3667, 18.8167, true);

-- If you already ran the previous version (ATLANTIC), update it:
-- UPDATE spots SET domain = 'FALSE_BAY' WHERE name = 'Pringle Bay';
