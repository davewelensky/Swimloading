-- Multi-region push notification subscriptions + new member alerts
-- Run in Supabase → SQL Editor

-- 1. Add preferred_locations array (replaces single preferred_location)
ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS preferred_locations text[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS notify_on_new_member boolean NOT NULL DEFAULT false;

-- 2. Migrate existing single-location subs into the array column
UPDATE push_subscriptions
SET preferred_locations = ARRAY[preferred_location]
WHERE preferred_location IS NOT NULL
  AND (preferred_locations IS NULL OR array_length(preferred_locations, 1) IS NULL);

-- 3. GIN index for fast array-overlap queries
CREATE INDEX IF NOT EXISTS idx_push_subs_locations_gin
    ON push_subscriptions USING GIN(preferred_locations);
