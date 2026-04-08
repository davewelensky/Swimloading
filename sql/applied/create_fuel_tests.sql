-- Fuel & Hydration Test table
-- Stores structured hydration/fuel protocol testing linked to swim sessions

CREATE TABLE IF NOT EXISTS fuel_tests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Session info
    test_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
    spot_id         UUID        REFERENCES spots(id),
    water_temp      NUMERIC(4,1),
    session_type    TEXT        CHECK (session_type IN ('pool', 'sea')) DEFAULT 'sea',
    distance_km     NUMERIC(4,1) DEFAULT 5,
    structure       TEXT        DEFAULT '5x1000m',

    -- Protocol
    protocol        TEXT        NOT NULL CHECK (protocol IN (
                                    'baseline',
                                    'ph500_during',
                                    'ph1500_preload',
                                    'ph1500_ph500',
                                    'fuel_test'
                                )),

    -- Intake
    intake_before   TEXT        DEFAULT 'none',
    intake_during   TEXT        DEFAULT 'none',
    intake_notes    TEXT,

    -- Per set effort (array of up to 5: easier / same / harder)
    set_efforts     TEXT[]      DEFAULT '{}',

    -- Session scores 1–10
    energy_consistency  SMALLINT CHECK (energy_consistency  BETWEEN 1 AND 10),
    perceived_effort    SMALLINT CHECK (perceived_effort    BETWEEN 1 AND 10),
    hydration_feeling   SMALLINT CHECK (hydration_feeling   BETWEEN 1 AND 10),
    stomach_comfort     SMALLINT CHECK (stomach_comfort     BETWEEN 1 AND 10),
    recovery            SMALLINT CHECK (recovery            BETWEEN 1 AND 10),

    -- Flags
    stronger_finish BOOLEAN     DEFAULT FALSE,
    faded_end       BOOLEAN     DEFAULT FALSE,
    thirst          BOOLEAN     DEFAULT FALSE,
    cramping        BOOLEAN     DEFAULT FALSE,

    -- Final verdict
    verdict         TEXT        CHECK (verdict IN ('worse', 'same', 'better')),

    -- Auto-generated summary
    auto_summary    TEXT
);

ALTER TABLE fuel_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own fuel tests"
    ON fuel_tests FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own fuel tests"
    ON fuel_tests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own fuel tests"
    ON fuel_tests FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own fuel tests"
    ON fuel_tests FOR DELETE
    USING (auth.uid() = user_id);

CREATE INDEX idx_fuel_tests_user_date ON fuel_tests (user_id, test_date DESC);
CREATE INDEX idx_fuel_tests_protocol  ON fuel_tests (user_id, protocol);
