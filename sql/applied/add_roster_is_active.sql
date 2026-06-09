-- Add is_active to club_roster so swimmers who have left can be deactivated
-- rather than deleted (preserves attendance history).
-- Safe: ADD COLUMN IF NOT EXISTS with DEFAULT TRUE means all existing rows stay active.

ALTER TABLE club_roster
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Index for the common filter pattern
CREATE INDEX IF NOT EXISTS club_roster_is_active_idx ON club_roster(club_id, is_active);
