-- 1. Add new columns to fuel_tests
ALTER TABLE fuel_tests ADD COLUMN IF NOT EXISTS test_category TEXT DEFAULT 'hydration';
ALTER TABLE fuel_tests ADD COLUMN IF NOT EXISTS air_temp_c   NUMERIC(4,1);
ALTER TABLE fuel_tests ADD COLUMN IF NOT EXISTS athlete_name TEXT    DEFAULT 'Carina';

-- 2. Update protocol CHECK to support new protocol values
ALTER TABLE fuel_tests DROP CONSTRAINT IF EXISTS fuel_tests_protocol_check;
ALTER TABLE fuel_tests ADD CONSTRAINT fuel_tests_protocol_check
    CHECK (protocol IN (
        'baseline','ph500_during','ph1500_preload','ph1500_ph500',
        'fuel_test','gel_during','chew_during','ph500_gel','custom'
    ));

-- 3. test_category constraint
ALTER TABLE fuel_tests DROP CONSTRAINT IF EXISTS fuel_tests_test_category_check;
ALTER TABLE fuel_tests ADD CONSTRAINT fuel_tests_test_category_check
    CHECK (test_category IN ('hydration','fuel','combined','baseline','custom_review_needed'));

-- 4. Backfill test_category from protocol
UPDATE fuel_tests SET test_category = 'baseline'  WHERE protocol = 'baseline'  AND test_category IS NULL;
UPDATE fuel_tests SET test_category = 'hydration' WHERE protocol IN ('ph500_during','ph1500_preload','ph1500_ph500') AND test_category IS NULL;
UPDATE fuel_tests SET test_category = 'fuel'      WHERE protocol IN ('fuel_test','gel_during','chew_during','ph500_gel') AND test_category IS NULL;
UPDATE fuel_tests SET test_category = 'custom_review_needed' WHERE test_category IS NULL;

-- 5. athlete_baselines table
CREATE TABLE IF NOT EXISTS athlete_baselines (
    id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    athlete_name           TEXT         NOT NULL UNIQUE,
    normal_session_type    TEXT         DEFAULT 'Pool',
    normal_distance_km     NUMERIC(4,1) DEFAULT 5.0,
    normal_structure       TEXT         DEFAULT '5 x 1000m',
    normal_during_intake   TEXT         DEFAULT 'Water only',
    baseline_energy_min    SMALLINT     DEFAULT 6,
    baseline_energy_max    SMALLINT     DEFAULT 7,
    baseline_hydration_min SMALLINT     DEFAULT 6,
    baseline_hydration_max SMALLINT     DEFAULT 7,
    baseline_stomach_min   SMALLINT     DEFAULT 8,
    baseline_stomach_max   SMALLINT     DEFAULT 9,
    baseline_effort_min    SMALLINT     DEFAULT 7,
    baseline_effort_max    SMALLINT     DEFAULT 8,
    baseline_recovery_min  SMALLINT     DEFAULT 6,
    baseline_recovery_max  SMALLINT     DEFAULT 7,
    baseline_notes         TEXT
);

ALTER TABLE athlete_baselines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PH participants can manage baselines" ON athlete_baselines;
CREATE POLICY "PH participants can manage baselines"
    ON athlete_baselines FOR ALL
    USING (auth.uid() IN ('df137255-3add-4153-b368-32e06e2be188','cff2fc33-4a55-451b-8c7f-20f12c1898ce'))
    WITH CHECK (auth.uid() IN ('df137255-3add-4153-b368-32e06e2be188','cff2fc33-4a55-451b-8c7f-20f12c1898ce'));

-- 6. Seed Carina's baseline (once)
INSERT INTO athlete_baselines (
    athlete_name, normal_session_type, normal_distance_km, normal_structure,
    normal_during_intake,
    baseline_energy_min, baseline_energy_max,
    baseline_hydration_min, baseline_hydration_max,
    baseline_stomach_min, baseline_stomach_max,
    baseline_effort_min, baseline_effort_max,
    baseline_recovery_min, baseline_recovery_max,
    baseline_notes
)
SELECT 'Carina','Pool',5.0,'5 x 1000m','Water only',
       6,7,6,7,8,9,7,8,6,7,
       'Daily 5 x 1000m pool session, usually water only.'
WHERE NOT EXISTS (SELECT 1 FROM athlete_baselines WHERE athlete_name = 'Carina');
