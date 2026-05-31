-- ================================================================
-- Migration: fix_health_events_rls.sql
--
-- Swimmers were getting "Could not save" when logging their own
-- injury/illness because there was no INSERT policy for members.
--
-- Adds:
--   1. RLS enabled (in case it wasn't)
--   2. Swimmers can INSERT and READ their own health events
--      (via club_roster.user_id = auth.uid())
--   3. Admins retain full access
-- ================================================================

ALTER TABLE club_health_events ENABLE ROW LEVEL SECURITY;

-- Swimmers: insert their own health event
DROP POLICY IF EXISTS "health_events_member_insert" ON club_health_events;
CREATE POLICY "health_events_member_insert" ON club_health_events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM club_roster
      WHERE id = roster_id
        AND user_id = auth.uid()
    )
  );

-- Swimmers: read their own health events
DROP POLICY IF EXISTS "health_events_member_read" ON club_health_events;
CREATE POLICY "health_events_member_read" ON club_health_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM club_roster
      WHERE id = roster_id
        AND user_id = auth.uid()
    )
  );

-- Admins: full access
DROP POLICY IF EXISTS "health_events_admin_all" ON club_health_events;
CREATE POLICY "health_events_admin_all" ON club_health_events
  FOR ALL
  USING (is_club_admin_or_organiser(club_id))
  WITH CHECK (is_club_admin_or_organiser(club_id));
