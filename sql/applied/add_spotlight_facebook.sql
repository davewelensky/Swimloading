-- Add Facebook URL to spotlights (for sharing swim events / reach)
-- Run once in Supabase → SQL Editor

ALTER TABLE spotlights ADD COLUMN IF NOT EXISTS facebook_url text;
