-- Add start_time column to spotlights table
ALTER TABLE spotlights ADD COLUMN IF NOT EXISTS start_time timestamptz;
