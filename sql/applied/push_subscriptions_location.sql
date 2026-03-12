-- Extend push_subscriptions with location-based notification prefs
-- Run once in Supabase → SQL Editor

ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS preferred_location text,
    ADD COLUMN IF NOT EXISTS notify_on_temp boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS notify_on_swim boolean NOT NULL DEFAULT true;

-- Index for fast location broadcast queries
CREATE INDEX IF NOT EXISTS idx_push_subs_location
    ON push_subscriptions(preferred_location)
    WHERE preferred_location IS NOT NULL;

-- Allow users to update their own subscription prefs (notify_on_temp, notify_on_swim)
DROP POLICY IF EXISTS "Users can update own subscriptions" ON push_subscriptions;
CREATE POLICY "Users can update own subscriptions"
    ON push_subscriptions FOR UPDATE
    USING (auth.uid() = user_id);
