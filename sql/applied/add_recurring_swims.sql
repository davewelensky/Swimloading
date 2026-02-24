-- Add recurring swim support to swim_events
-- recurrence_type: 'daily', 'weekly', 'fortnightly' (NULL = one-time event)
-- recurrence_end_date: series runs until this date
-- recurrence_series_id: shared UUID across all instances in a series

ALTER TABLE swim_events
  ADD COLUMN IF NOT EXISTS recurrence_type TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_end_date DATE,
  ADD COLUMN IF NOT EXISTS recurrence_series_id UUID;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'swim_events'
  AND column_name IN ('recurrence_type', 'recurrence_end_date', 'recurrence_series_id');
