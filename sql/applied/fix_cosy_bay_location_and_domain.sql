-- Cosy Bay: correct domain (FALSE_BAY → ATLANTIC) and GPS coordinates.
-- Located past Beta Beach / Bakoven toward Hout Bay, not near Simons Town.
UPDATE spots
SET
  domain    = 'ATLANTIC',
  latitude  = -33.98205152245172,
  longitude = 18.361365581566623
WHERE id = '975d89de-846c-4937-a7ae-df2e41e292e2';
