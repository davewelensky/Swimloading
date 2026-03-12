-- Multi-region push notification subscriptions + new member alerts
-- Run in Supabase → SQL Editor
-- Safe to re-run: uses IF NOT EXISTS throughout

-- 1. Add preferred_locations array (if not already present)
ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS preferred_locations text[] DEFAULT '{}';

-- 2. Add new_member alert flag
ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS notify_on_new_member boolean NOT NULL DEFAULT false;

-- 3. GIN index for fast array-overlap queries
CREATE INDEX IF NOT EXISTS idx_push_subs_locations_gin
    ON push_subscriptions USING GIN(preferred_locations);
