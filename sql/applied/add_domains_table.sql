-- ============================================
-- Dynamic Domains Table
-- Replaces hardcoded domain arrays in JS code.
-- Adding a new region = INSERT here only.
-- Run in Supabase SQL Editor BEFORE deploying JS changes.
-- ============================================

-- 1. Create domains reference table
CREATE TABLE IF NOT EXISTS domains (
    code         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    is_coastal   BOOLEAN DEFAULT true,
    sort_order   INTEGER DEFAULT 99,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. RLS — public read, admin write
ALTER TABLE domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view domains" ON domains;
CREATE POLICY "Public can view domains"
    ON domains FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage domains" ON domains;
CREATE POLICY "Admins can manage domains"
    ON domains FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- 3. Seed all current domains in display order
INSERT INTO domains (code, display_name, is_coastal, sort_order) VALUES
    ('ATLANTIC',     'Atlantic',       true,  1),
    ('FALSE_BAY',    'False Bay',      true,  2),
    ('WEST_COAST',   'West Coast',     true,  3),
    ('SOUTH_COAST',  'South Coast',    true,  4),
    ('GARDEN_ROUTE', 'Garden Route',   true,  5),
    ('EASTERN_CAPE', 'Eastern Cape',   true,  6),
    ('KZN',          'KwaZulu-Natal',  true,  7),
    ('INLAND',       'Pools & Inland', false, 8),
    ('NON_COASTAL',  'Non-Coastal',    false, 9),
    ('NAMIBIA',      'Namibia',        true,  10)
ON CONFLICT (code) DO NOTHING;

-- 4. Replace CHECK constraint on spots with FK to domains table
--    ON UPDATE CASCADE means renaming a domain code automatically updates all spots.
--    Adding a new domain now requires only an INSERT into this table — no constraint update.
ALTER TABLE spots DROP CONSTRAINT IF EXISTS spots_domain_check;
ALTER TABLE spots DROP CONSTRAINT IF EXISTS spots_domain_fkey;
ALTER TABLE spots ADD CONSTRAINT spots_domain_fkey
    FOREIGN KEY (domain) REFERENCES domains(code)
    ON UPDATE CASCADE;
