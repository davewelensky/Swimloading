-- Add EASTERN_CAPE domain and Kenton-on-Sea spot
-- Run in Supabase SQL Editor

-- 1. Update the domain constraint to include EASTERN_CAPE
ALTER TABLE public.spots DROP CONSTRAINT spots_domain_check;
ALTER TABLE public.spots ADD CONSTRAINT spots_domain_check CHECK (
  domain IN (
    'ATLANTIC', 'FALSE_BAY', 'WEST_COAST', 'SOUTH_COAST', 'GARDEN_ROUTE',
    'EASTERN_CAPE', 'INLAND', 'NON_COASTAL', 'NAMIBIA'
  )
);

-- 2. Insert Kenton-on-Sea
INSERT INTO spots (name, code, water_type, domain, latitude, longitude, active)
VALUES ('Kenton-on-Sea', 'KENTON', 'OCEAN', 'EASTERN_CAPE', -33.68432199973655, 26.673777380759155, true);
