-- Add max_members to club_squads
-- Enables squad capacity intelligence in Squad Tracker:
-- full / near-full / open status shown per squad at a glance.
ALTER TABLE club_squads ADD COLUMN IF NOT EXISTS max_members integer;
