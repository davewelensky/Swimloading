-- Setup badges system
-- Run in Supabase SQL Editor
-- Date: 2026-02-17
--
-- The badges are defined client-side in BADGE_DEFINITIONS array in index.html
-- This script ensures the user_badges table exists to store earned badges

-- Create user_badges table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_badges (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    badge_id text NOT NULL,
    earned_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE(user_id, badge_id)
);

-- Enable RLS
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Anyone can view badges" ON user_badges;
CREATE POLICY "Anyone can view badges"
  ON user_badges FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can earn badges" ON user_badges;
CREATE POLICY "Users can earn badges"
  ON user_badges FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);
