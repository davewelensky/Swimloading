-- Fix domain groupings: move Bloubergstrand-area ocean spots from ATLANTIC to WEST_COAST
-- Big Bay and Small Bay are in Bloubergstrand, which is geographically WEST_COAST
-- Atlantic Seaboard should only contain: Sea Point, Clifton, Camps Bay, Bakoven,
--   Llandudno, Sandy Bay, Hout Bay area, and Boulders/Simon's Town area spots

-- Move Big Bay and Small Bay to WEST_COAST
UPDATE spots
SET domain = 'WEST_COAST'
WHERE name IN ('Big Bay', 'Small Bay')
  AND domain = 'ATLANTIC';

-- Also catch any other Blouberg-named spots that may have landed in ATLANTIC
UPDATE spots
SET domain = 'WEST_COAST'
WHERE name ILIKE '%blouberg%'
  AND domain = 'ATLANTIC';

-- Verify: show all ATLANTIC spots after the fix
-- Expected: Sea Point, Clifton, Camps Bay, Bakoven, Llandudno, Sandy Bay, Hout Bay,
--           Glen Beach, Queens Beach — NOT Big Bay / Small Bay / Blouberg
SELECT id, name, water_type, domain, code, active
FROM spots
WHERE domain = 'ATLANTIC'
  AND active = true
ORDER BY name;

-- Verify: show all WEST_COAST spots after the fix
-- Should now include Big Bay, Small Bay alongside Melkbosstrand, Yzerfontein, etc.
SELECT id, name, water_type, domain, code, active
FROM spots
WHERE domain = 'WEST_COAST'
  AND active = true
ORDER BY name;
