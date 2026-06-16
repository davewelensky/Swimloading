-- Crossing Intelligence Pro — data model
-- Run in Supabase SQL Editor
-- Phase 1: crossings, crossing_attempts, crossing_evidence, crossing_prep_notes
-- Also adds duration_minutes to temp_logs for cold hour calculation

-- ─── ADD duration_minutes TO temp_logs ────────────────────────────────────────
ALTER TABLE temp_logs ADD COLUMN IF NOT EXISTS duration_minutes integer;
ALTER TABLE temp_logs ADD COLUMN IF NOT EXISTS location_type text
    CHECK (location_type IN ('pool','lido','open_water'));

-- ─── crossings ────────────────────────────────────────────────────────────────
-- Crossing definitions with benchmarks. Benchmarks are editable by admin.
-- benchmark fields are marked as seeded defaults where no empirical data available.

CREATE TABLE IF NOT EXISTS crossings (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                        text UNIQUE NOT NULL,
    name                        text NOT NULL,
    region                      text,
    country                     text,
    distance_km                 numeric,
    typical_temp_min_c          numeric,
    typical_temp_max_c          numeric,
    benchmark_weekly_km         numeric,   -- seeded default, admin-editable
    benchmark_long_swim_km      numeric,   -- seeded default, admin-editable
    benchmark_cold_hours        numeric,   -- total hours cold exposure target
    benchmark_open_water_percent numeric,  -- % open water sessions target
    qualifying_duration_minutes integer,   -- e.g. 360 = 6hr qualifier
    qualifying_temp_limit_c     numeric,   -- e.g. 16°C
    requires_observer           boolean DEFAULT false,
    difficulty                  text,
    description                 text,
    created_at                  timestamptz DEFAULT now(),
    updated_at                  timestamptz DEFAULT now()
);

-- RLS: public read, only service role can write
ALTER TABLE crossings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crossings_public_read" ON crossings FOR SELECT USING (true);

-- Seed initial crossings
-- benchmark_weekly_km: conservative target for the build phase
-- benchmark_long_swim_km: target long session before peak phase
-- benchmark_cold_hours: total cold-water hours logged (using duration_minutes)
-- benchmark_open_water_percent: % of sessions in open/coastal water

INSERT INTO crossings (
    slug, name, region, country,
    distance_km, typical_temp_min_c, typical_temp_max_c,
    benchmark_weekly_km, benchmark_long_swim_km, benchmark_cold_hours, benchmark_open_water_percent,
    qualifying_duration_minutes, qualifying_temp_limit_c, requires_observer, difficulty, description
) VALUES
(
    'english-channel', 'English Channel', 'English Channel', 'United Kingdom / France',
    33, 14, 18,
    50, 20, 20, 70,
    360, 16, true, 'extreme',
    'The benchmark of marathon swimming. 33km from Dover to Cap Gris-Nez (or reverse). Water temperatures of 14–18°C, tidal currents, shipping lanes. Governed by CSA and CS&PF. A 6-hour qualifying swim in ≤16°C with an approved observer is required.'
),
(
    'robben-island', 'Robben Island', 'Cape Town', 'South Africa',
    7.5, 12, 16,
    25, 8, 10, 80,
    120, 14, true, 'advanced',
    'Table Bay crossing from Robben Island to Big Bay, Cape Town. Cold Atlantic water (12–16°C), strong currents and swells. One of South Africa''s most prestigious open water swims. Organised by Robben Island Swim Association.'
),
(
    'false-bay', 'False Bay Crossing', 'False Bay', 'South Africa',
    33, 14, 20,
    50, 20, 8, 80,
    360, 18, false, 'extreme',
    'A 33km crossing of False Bay from Gordon''s Bay to Fish Hoek (or reverse). South Africa''s longest coastal crossing. Warmer than Atlantic swims but unpredictable — conditions change rapidly. Cape Doctor (south-easter) creates significant chop.'
),
(
    'manhattan-island', 'Manhattan Island Marathon Swim', 'New York', 'USA',
    48, 18, 24,
    65, 25, 0, 80,
    null, null, false, 'extreme',
    '28.5-mile circumnavigation of Manhattan Island. Tidal currents are your engine — timing is everything. Water temperatures 18–24°C. NYC Marathon Swimming governs the event.'
),
(
    'catalina-channel', 'Catalina Channel', 'California', 'USA',
    33, 16, 22,
    50, 20, 4, 80,
    null, null, false, 'extreme',
    '33km from Catalina Island to the Palos Verdes Peninsula (or reverse). Governed by the Catalina Channel Swimming Federation. Kelp, sea lions, and the possibility of strong currents. Water temperatures 16–22°C.'
),
(
    'north-channel', 'North Channel', 'Northern Ireland / Scotland', 'UK',
    34.5, 10, 14,
    55, 22, 30, 85,
    360, 12, true, 'extreme',
    'The coldest and most notorious of the Oceans Seven. 34.5km from Northern Ireland to Scotland. Water temperatures of 10–14°C with lion''s mane jellyfish a significant hazard. The hardest channel swim in the world.'
),
(
    'rottnest-channel', 'Rottnest Channel Swim', 'Western Australia', 'Australia',
    19.7, 18, 22,
    40, 15, 0, 80,
    null, null, false, 'advanced',
    '19.7km from Cottesloe Beach to Rottnest Island, Perth. The world''s largest open water swim event. Solo, duo, and team categories. Water temperatures typically 18–22°C. Governed by Rottnest Channel Swim Association.'
),
(
    'cook-strait', 'Cook Strait', 'Wellington', 'New Zealand',
    26, 12, 16,
    50, 18, 20, 85,
    null, null, false, 'extreme',
    '26km between New Zealand''s North and South Islands. Extreme currents — navigation skill is as important as swimming speed. Cold water (12–16°C). Part of the Oceans Seven.'
),
(
    'molokai-channel', 'Molokai Channel', 'Hawaii', 'USA',
    42, 22, 26,
    65, 25, 0, 85,
    null, null, false, 'extreme',
    'The Ka''iwi Channel, 42km from Molokai to Oahu. Among the world''s most challenging — 4-metre swells, jellyfish, sharks. Part of the Oceans Seven. Water temperatures 22–26°C.'
),
(
    'strait-of-gibraltar', 'Strait of Gibraltar', 'Gibraltar', 'Spain / Morocco',
    14.4, 18, 22,
    30, 10, 0, 85,
    null, null, false, 'advanced',
    '14.4km between Europe and Africa. Strong currents mean the actual swim can be 15–25km. Water 18–22°C. Surprisingly warm but technically demanding due to tidal flow. Part of the Oceans Seven.'
),
(
    'tsugaru-strait', 'Tsugaru Strait', 'Japan', 'Japan',
    20, 14, 18,
    40, 15, 10, 85,
    null, null, false, 'extreme',
    'The Tsugaru Strait between Honshu and Hokkaido, Japan. 20km but actual swim distance is longer due to tidal currents. Water 14–18°C. Part of the Oceans Seven.'
),
(
    'custom-marathon-swim', 'Custom Marathon Swim', null, null,
    null, null, null,
    40, 15, 5, 75,
    null, null, false, 'advanced',
    'A custom marathon swim goal. Benchmarks are generic defaults — update your crossing details and adjust benchmarks to match your specific target.'
)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

-- ─── crossing_attempts ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crossing_attempts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    crossing_id     uuid NOT NULL REFERENCES crossings(id),
    target_date     date,
    status          text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('planning','active','qualifying','taper','completed','paused','cancelled')),
    goal_time_minutes integer,
    coach_name      text,
    pilot_name      text,
    notes           text,
    is_pro          boolean DEFAULT false,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

ALTER TABLE crossing_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crossing_attempts_owner_all" ON crossing_attempts
    FOR ALL USING (auth.uid() = user_id);

-- service role can access everything (for admin)
CREATE POLICY "crossing_attempts_service_all" ON crossing_attempts
    FOR ALL USING (auth.role() = 'service_role');

-- ─── crossing_evidence ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crossing_evidence (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    crossing_attempt_id     uuid NOT NULL REFERENCES crossing_attempts(id) ON DELETE CASCADE,
    swim_id                 text,  -- FK to temp_logs.id (uuid stored as text for flexibility)
    evidence_type           text NOT NULL
                                CHECK (evidence_type IN (
                                    'long_swim','cold_acclimation','qualifying_swim',
                                    'feed_practice','night_swim','rough_water',
                                    'open_water','recovery_swim','technique_pool','crew_practice'
                                )),
    evidence_status         text NOT NULL DEFAULT 'pending'
                                CHECK (evidence_status IN ('pending','complete','rejected','not_applicable')),
    evidence_date           date,
    duration_minutes        integer,
    distance_km             numeric,
    water_temperature_c     numeric,
    location_name           text,
    observer_name           text,
    observer_contact        text,
    notes                   text,
    created_at              timestamptz DEFAULT now(),
    updated_at              timestamptz DEFAULT now()
);

ALTER TABLE crossing_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crossing_evidence_owner_all" ON crossing_evidence
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "crossing_evidence_service_all" ON crossing_evidence
    FOR ALL USING (auth.role() = 'service_role');

-- ─── crossing_prep_notes ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crossing_prep_notes (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    crossing_attempt_id     uuid NOT NULL REFERENCES crossing_attempts(id) ON DELETE CASCADE,
    note_type               text NOT NULL
                                CHECK (note_type IN (
                                    'coach_notes','pilot_notes','feed_plan',
                                    'risks','next_week_focus','crew_notes'
                                )),
    note_text               text NOT NULL,
    created_at              timestamptz DEFAULT now(),
    updated_at              timestamptz DEFAULT now()
);

ALTER TABLE crossing_prep_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prep_notes_owner_all" ON crossing_prep_notes
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "prep_notes_service_all" ON crossing_prep_notes
    FOR ALL USING (auth.role() = 'service_role');

-- ─── crossing_targets migration ───────────────────────────────────────────────
-- crossing_targets already exists. Keep it for backward compat.
-- crossing_attempts is the new authority; crossing_targets acts as legacy fallback.

-- ─── community benchmark view ─────────────────────────────────────────────────
-- Aggregated view — never exposes individual data
-- Only shown when sample_size >= 3

CREATE OR REPLACE VIEW crossing_community_benchmark AS
SELECT
    c.slug,
    c.name,
    ca.crossing_id,
    COUNT(DISTINCT ca.user_id) AS active_swimmers,
    AVG(CASE WHEN tl.distance_km > 0 THEN tl.distance_km END) AS avg_session_km,
    AVG(tl.temp_c) AS avg_temp_c,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tl.distance_km) AS median_session_km
FROM crossing_attempts ca
JOIN crossings c ON c.id = ca.crossing_id
JOIN temp_logs tl ON tl.created_by = ca.user_id
    AND tl.created_at > now() - interval '28 days'
WHERE ca.status IN ('active','qualifying','taper')
GROUP BY c.slug, c.name, ca.crossing_id;
