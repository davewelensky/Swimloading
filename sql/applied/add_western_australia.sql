-- ============================================================
-- Add Western Australia domain + Cottesloe Beach
-- Perth, Western Australia — Indian Ocean
-- Run once in Supabase → SQL Editor
-- ============================================================

-- 1. Add Western Australia domain
INSERT INTO domains (code, display_name, is_coastal, sort_order)
VALUES ('WESTERN_AUSTRALIA', 'Western Australia', true, 110);

-- 2. Add Cottesloe Beach
INSERT INTO spots (name, code, water_type, domain, latitude, longitude, active)
VALUES ('Cottesloe Beach', 'COTTESLOE', 'OCEAN', 'WESTERN_AUSTRALIA', -31.995859603692672, 115.75024080220855, true);
