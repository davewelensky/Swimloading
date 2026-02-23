-- ============================================================
-- Add spot codes to spots missing them
-- Spots without a code are invisible to latest_spot_temps view
-- (the view has WHERE s.code IS NOT NULL)
-- Run once in Supabase → SQL Editor
-- ============================================================

-- Quaggaskloof Water-Ski Club (Brandvlei Dam, Worcester)
UPDATE spots SET code = 'QUAG' WHERE name = 'Quaggaskloof Water-Ski Club';

-- Old Eds Outdoor Pool (Lower Houghton, Johannesburg)
UPDATE spots SET code = 'OEDS' WHERE name = 'Old Eds Outdoor Pool';

-- Silvermine Dam (Tokai, Cape Town) — if it exists without a code
UPDATE spots SET code = 'SILV' WHERE name ILIKE '%Silvermine%' AND code IS NULL;

-- Pringle Bay
UPDATE spots SET code = 'PRNG' WHERE name = 'Pringle Bay' AND code IS NULL;

-- Verify: check all spots that still have no code
-- SELECT id, name, water_type, domain, code FROM spots WHERE code IS NULL AND active = true;
