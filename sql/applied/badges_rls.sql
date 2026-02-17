-- Ensure RLS is enabled on badges and user_badges tables
-- Run in Supabase SQL Editor
-- Date: 2026-02-17

-- badges table: anyone authenticated can read badge definitions
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view badges" ON badges;
CREATE POLICY "Authenticated users can view badges"
  ON badges FOR SELECT
  USING (auth.role() = 'authenticated');

-- user_badges table: users can view all earned badges, insert own
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view all earned badges" ON user_badges;
CREATE POLICY "Authenticated users can view all earned badges"
  ON user_badges FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can earn badges" ON user_badges;
CREATE POLICY "Users can earn badges"
  ON user_badges FOR INSERT
  WITH CHECK (auth.uid() = user_id);
