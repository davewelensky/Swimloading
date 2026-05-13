-- Add per-club feature flags — replaces blunt club_type gating
-- Each feature is a boolean in features jsonb on the clubs table.
-- Adding a new club = set its flags in DB. Zero code changes needed.
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '{}';

-- DUC: open water, league, temp challenge
UPDATE clubs SET features = '{
  "league":          true,
  "temp_challenge":  true,
  "squads":          false,
  "timetable":       false,
  "attendance":      false,
  "gala_entries":    false,
  "coaching_staff":  false,
  "parent_language": false
}'::jsonb WHERE slug = 'duc';

-- Aqua Sharks: squad club
UPDATE clubs SET features = '{
  "league":          false,
  "temp_challenge":  false,
  "squads":          true,
  "timetable":       true,
  "attendance":      true,
  "gala_entries":    true,
  "coaching_staff":  true,
  "parent_language": true
}'::jsonb WHERE slug = 'aqua-sharks-atlantic';
