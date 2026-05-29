-- ================================================================
-- Migration: add_gala_entry_requests.sql
--
-- Adds swimmer self-service gala entry requests.
--   1. session_number column on club_gala_entries (Session 1 / 2)
--   2. swimmer_notes column for free-text requests
--   3. Extends status CHECK to allow 'requested'
--   4. RLS: swimmer can read/insert/update their own entries
--      via club_roster.user_id = auth.uid()
-- ================================================================

-- 1. New columns
ALTER TABLE club_gala_entries
  ADD COLUMN IF NOT EXISTS session_number  smallint,
  ADD COLUMN IF NOT EXISTS swimmer_notes   text;

-- 2. Extend status constraint to allow 'requested'
ALTER TABLE club_gala_entries
  DROP CONSTRAINT IF EXISTS club_gala_entries_status_check;

ALTER TABLE club_gala_entries
  ADD CONSTRAINT club_gala_entries_status_check
  CHECK (status IN ('entered', 'scratched', 'requested'));

-- 3. Enable RLS (may already be enabled)
ALTER TABLE club_gala_entries ENABLE ROW LEVEL SECURITY;

-- 4. Helper: resolve roster_id → user_id (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION get_roster_user_id(p_roster_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT user_id FROM club_roster WHERE id = p_roster_id
$$;

-- 5. RLS policies for swimmers
-- Swimmers read their own entries
DROP POLICY IF EXISTS "gala_entries_swimmer_read" ON club_gala_entries;
CREATE POLICY "gala_entries_swimmer_read" ON club_gala_entries
  FOR SELECT
  USING (get_roster_user_id(roster_id) = auth.uid());

-- Swimmers insert their own entries (status must be 'requested')
DROP POLICY IF EXISTS "gala_entries_swimmer_insert" ON club_gala_entries;
CREATE POLICY "gala_entries_swimmer_insert" ON club_gala_entries
  FOR INSERT
  WITH CHECK (
    get_roster_user_id(roster_id) = auth.uid()
    AND status = 'requested'
  );

-- Swimmers update their own entries (can change events/notes/session, stays 'requested')
DROP POLICY IF EXISTS "gala_entries_swimmer_update" ON club_gala_entries;
CREATE POLICY "gala_entries_swimmer_update" ON club_gala_entries
  FOR UPDATE
  USING (get_roster_user_id(roster_id) = auth.uid())
  WITH CHECK (
    get_roster_user_id(roster_id) = auth.uid()
    AND status = 'requested'
  );

-- Swimmers can delete (scratch) their own requested entries
DROP POLICY IF EXISTS "gala_entries_swimmer_delete" ON club_gala_entries;
CREATE POLICY "gala_entries_swimmer_delete" ON club_gala_entries
  FOR DELETE
  USING (
    get_roster_user_id(roster_id) = auth.uid()
    AND status = 'requested'
  );

-- Admin full access (read all, write all)
DROP POLICY IF EXISTS "gala_entries_admin_all" ON club_gala_entries;
CREATE POLICY "gala_entries_admin_all" ON club_gala_entries
  FOR ALL
  USING (is_club_admin_or_organiser(club_id))
  WITH CHECK (is_club_admin_or_organiser(club_id));

-- club_events public read for swimmer portal
DROP POLICY IF EXISTS "events_public_read" ON club_events;
CREATE POLICY "events_public_read" ON club_events
  FOR SELECT USING (is_active = true);
