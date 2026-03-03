-- ============================================
-- Add KwaZulu-Natal (KZN) domain + Durban spots
-- Run in Supabase SQL Editor
-- ============================================

-- 1. Update domain constraint to include KZN
ALTER TABLE spots DROP CONSTRAINT IF EXISTS spots_domain_check;
ALTER TABLE spots ADD CONSTRAINT spots_domain_check
    CHECK (domain IN (
        'ATLANTIC', 'FALSE_BAY', 'WEST_COAST', 'SOUTH_COAST',
        'GARDEN_ROUTE', 'EASTERN_CAPE', 'KZN', 'INLAND', 'NON_COASTAL', 'NAMIBIA'
    ));

-- 2. Insert KZN spots
INSERT INTO spots (name, domain, water_type, latitude, longitude, active)
VALUES
    ('DUC', 'KZN', 'OCEAN', -29.869091, 31.053618, true),
    ('Durban Surf', 'KZN', 'OCEAN', -29.850122, 31.039588, true),
    ('Umhloti Beach', 'KZN', 'OCEAN', -29.664785, 31.122931, true)
ON CONFLICT DO NOTHING;
