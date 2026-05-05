-- Allow anyone (anon or authenticated) to read public club events
-- Required for the main SwimLoading events feed to surface public club races/swims
-- Run in: Supabase → SQL Editor

DROP POLICY IF EXISTS "public_events_read" ON club_events;

CREATE POLICY "public_events_read"
  ON club_events
  FOR SELECT
  USING (is_public = true AND is_active = true);
