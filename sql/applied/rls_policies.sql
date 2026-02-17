-- ============================================
-- SwimLoading: Row Level Security Policies
-- Run this in Supabase → SQL Editor
-- Drops existing policies first to avoid conflicts
-- ============================================

-- ==========================================
-- 1. PROFILES
-- ==========================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view profiles" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Anyone can view profiles"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ==========================================
-- 2. SWIM_EVENTS
-- ==========================================
ALTER TABLE swim_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view all events" ON swim_events;
DROP POLICY IF EXISTS "Authenticated users can create events" ON swim_events;
DROP POLICY IF EXISTS "Creators can update own events" ON swim_events;

CREATE POLICY "Authenticated users can view all events"
  ON swim_events FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create events"
  ON swim_events FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Creators can update own events"
  ON swim_events FOR UPDATE
  USING (auth.uid() = created_by);

-- ==========================================
-- 3. SWIM_PARTICIPANTS
-- ==========================================
ALTER TABLE swim_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view participants" ON swim_participants;
DROP POLICY IF EXISTS "Users can join events" ON swim_participants;
DROP POLICY IF EXISTS "Users can update own participation or creators can manage" ON swim_participants;

CREATE POLICY "Authenticated users can view participants"
  ON swim_participants FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can join events"
  ON swim_participants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own participation or creators can manage"
  ON swim_participants FOR UPDATE
  USING (
    auth.uid() = user_id
    OR
    auth.uid() IN (
      SELECT created_by FROM swim_events WHERE id = swim_event_id
    )
  );

-- ==========================================
-- 4. TEMP_LOGS
-- ==========================================
ALTER TABLE temp_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view all temp logs" ON temp_logs;
DROP POLICY IF EXISTS "Users can insert own temp logs" ON temp_logs;

CREATE POLICY "Authenticated users can view all temp logs"
  ON temp_logs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert own temp logs"
  ON temp_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ==========================================
-- 5. USER_STATS
-- ==========================================
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view all stats" ON user_stats;

CREATE POLICY "Authenticated users can view all stats"
  ON user_stats FOR SELECT
  USING (auth.role() = 'authenticated');

-- ==========================================
-- 6. NOTIFICATIONS
-- ==========================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = recipient_user_id);

CREATE POLICY "Authenticated users can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = recipient_user_id);

-- ==========================================
-- 7. SPOTS
-- ==========================================
ALTER TABLE spots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view spots" ON spots;

CREATE POLICY "Authenticated users can view spots"
  ON spots FOR SELECT
  USING (auth.role() = 'authenticated');
