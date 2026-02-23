-- Add Robben Island as a swimming spot — WEST_COAST domain
-- Robben Island sits in Table Bay directly across from Big Bay (Bloubergstrand)
-- Daily swimmers cross ~11km from the island to Big Bay — one of SA's iconic open water swims
-- Coordinates: Murray's Bay Harbour (east side of island) — the typical swim start point

INSERT INTO spots (name, code, water_type, domain, latitude, longitude, active)
VALUES ('Robben Island', 'RBNI', 'OCEAN', 'WEST_COAST', -33.8069, 18.3671, true);

-- Verify
SELECT id, name, code, water_type, domain, latitude, longitude, active
FROM spots
WHERE name = 'Robben Island';
