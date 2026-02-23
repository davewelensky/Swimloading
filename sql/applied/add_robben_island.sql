-- Robben Island already exists in spots table — update domain, code and coordinates
-- Murray's Bay Harbour (east side) is the correct start point for the 7.4km crossing to Big Bay

UPDATE spots
SET
    domain    = 'WEST_COAST',
    code      = 'RBNI',
    latitude  = -33.8069,
    longitude = 18.3671,
    active    = true
WHERE lower(name) = 'robben island';

-- Verify
SELECT id, name, code, water_type, domain, latitude, longitude, active
FROM spots
WHERE lower(name) = 'robben island';
