-- Spot suggestions table
-- Users can suggest new swim spots for admin review
-- Run in Supabase SQL Editor
-- Date: 2026-02-18

CREATE TABLE IF NOT EXISTS spot_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spot_name TEXT NOT NULL,
    water_type TEXT NOT NULL CHECK (water_type IN ('OCEAN', 'POOL', 'DAM', 'LAGOON')),
    region TEXT,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Users can insert own suggestions (max 3 pending) and read their own
ALTER TABLE spot_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own suggestions" ON spot_suggestions;
CREATE POLICY "Users can view own suggestions"
  ON spot_suggestions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can suggest spots" ON spot_suggestions;
CREATE POLICY "Users can suggest spots"
  ON spot_suggestions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      SELECT COUNT(*) FROM spot_suggestions
      WHERE user_id = auth.uid() AND status = 'pending'
    ) < 3
  );

CREATE INDEX IF NOT EXISTS idx_spot_suggestions_status ON spot_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_spot_suggestions_user_id ON spot_suggestions(user_id);
