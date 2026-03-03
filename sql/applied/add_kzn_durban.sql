-- ============================================
-- Add KwaZulu-Natal (KZN) domain + Durban spots
-- Run in Supabase SQL Editor
-- ============================================

-- 1. Update domain constraint to include KZN
-- NOT VALID skips scanning existing rows (we know data is clean);
-- new inserts/updates are still enforced immediately.
ALTER TABLE spots DROP CONSTRAINT IF EXISTS spots_domain_check;
ALTER TABLE spots ADD CONSTRAINT spots_domain_check
    CHECK (domain IN (
        'ATLANTIC', 'FALSE_BAY', 'WEST_COAST', 'SOUTH_COAST',
        'GARDEN_ROUTE', 'EASTERN_CAPE', 'KZN', 'INLAND', 'NON_COASTAL', 'NAMIBIA'
    )) NOT VALID;

-- 2. Insert KZN spots (code is required — without it spot is invisible in Trends)
INSERT INTO spots (name, code, domain, water_type, latitude, longitude, active)
VALUES
    ('DUC',          'DUC',         'KZN', 'OCEAN', -29.869091, 31.053618, true),
    ('Durban Surf',  'DURBAN_SURF', 'KZN', 'OCEAN', -29.850122, 31.039588, true),
    ('Umhloti Beach','UMHLOTI',     'KZN', 'OCEAN', -29.664785, 31.122931, true)
ON CONFLICT DO NOTHING;

-- 3. Fix codes if spots were already inserted without them
UPDATE spots SET code = 'DUC'         WHERE name = 'DUC'          AND domain = 'KZN' AND code IS NULL;
UPDATE spots SET code = 'DURBAN_SURF' WHERE name = 'Durban Surf'  AND domain = 'KZN' AND code IS NULL;
UPDATE spots SET code = 'UMHLOTI'     WHERE name = 'Umhloti Beach' AND domain = 'KZN' AND code IS NULL;
