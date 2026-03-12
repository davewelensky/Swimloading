-- Add second tracking URL to spotlights (for swims with multiple escort boats)
-- Run once in Supabase → SQL Editor

ALTER TABLE spotlights ADD COLUMN IF NOT EXISTS tracking_url_2 text;
