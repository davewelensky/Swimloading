-- Fix spot domain assignments — March 2026
-- Run once in Supabase → SQL Editor

-- Milnerton is geographically West Coast (north of Cape Town), not Atlantic Seaboard
UPDATE spots SET domain = 'WEST_COAST' WHERE name = 'Milnerton' AND domain = 'ATLANTIC';

-- Sea Point Pavilion is a pool, belongs in Pools & Inland
UPDATE spots SET domain = 'INLAND' WHERE name = 'Sea Point Pavilion';

-- Trafalgar Swimming Pool is a pool, belongs in Pools & Inland
UPDATE spots SET domain = 'INLAND' WHERE name = 'Trafalgar Swimming Pool';

-- Verify
SELECT name, domain, water_type FROM spots
WHERE name IN ('Milnerton', 'Sea Point Pavilion', 'Trafalgar Swimming Pool')
ORDER BY name;
