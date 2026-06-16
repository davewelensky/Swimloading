-- ============================================================
-- Add new badge definitions
-- Run once in Supabase → SQL Editor
-- ============================================================

-- STEP 1: Check what categories already exist (run this first
--         to see the output, then proceed with steps 2+3)
-- SELECT DISTINCT category FROM badges;

-- STEP 2: Drop the existing constraint entirely (no replacement yet)
ALTER TABLE badges DROP CONSTRAINT IF EXISTS badges_category_check;

-- STEP 3: Insert the new badge definitions
-- (no constraint active — safe to insert any category now)

INSERT INTO badges (name, icon, description, category, criteria)
VALUES ('Early Bird', '🌅', 'Logged a water temp before 6am', 'activity', '{"time_before": "06:00"}');

INSERT INTO badges (name, icon, description, category, criteria)
VALUES ('On a Roll', '🔥', 'Logged temps 5 days in a row', 'streak', '{"streak_required": 5}');

INSERT INTO badges (name, icon, description, category, criteria)
VALUES ('Dedicated', '💪', 'Logged temps 10 days in a row', 'streak', '{"streak_required": 10}');

INSERT INTO badges (name, icon, description, category, criteria)
VALUES ('Iron Swimmer', '🏅', 'Logged temps 30 days in a row', 'streak', '{"streak_required": 30}');

INSERT INTO badges (name, icon, description, category, criteria)
VALUES ('Cold Water Lover', '🥶', 'Logged a swim in water 15°C or below', 'cold', '{"temp_max": 15}');

INSERT INTO badges (name, icon, description, category, criteria)
VALUES ('Freezing Brave', '🧊', 'Logged a swim in water 12°C or below', 'cold', '{"temp_max": 12}');

INSERT INTO badges (name, icon, description, category, criteria)
VALUES ('Host', '🎯', 'Organised your first group swim', 'social', '{"organised_required": 1}');

INSERT INTO badges (name, icon, description, category, criteria)
VALUES ('Swim Leader', '🏊', 'Organised 5 group swims', 'social', '{"organised_required": 5}');

-- STEP 4: Re-add constraint covering ALL categories now in the table
-- (run "SELECT DISTINCT category FROM badges" after step 3 to confirm,
--  then run this — adjust the list if your existing badges use other values)
ALTER TABLE badges ADD CONSTRAINT badges_category_check
    CHECK (category IN (
        'temperature', 'participation', 'social', 'streak', 'activity', 'cold'
    ));
