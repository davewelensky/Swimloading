-- SwimLoading — "I'm Swimming" lightweight swim posts
-- Run once in Supabase SQL editor before deploying the feature

-- ── Table 1: swimming_posts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS swimming_posts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spot_id       uuid NOT NULL REFERENCES spots(id),
    swim_datetime timestamptz NOT NULL,
    notes         text CHECK (char_length(notes) <= 100),
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL   -- auto-set to swim_datetime + 2 hours on insert
);

ALTER TABLE swimming_posts ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read upcoming posts
CREATE POLICY "Auth users read swimming_posts"
    ON swimming_posts FOR SELECT
    USING (auth.role() = 'authenticated');

-- Users can only insert their own posts
CREATE POLICY "Users insert own swimming_posts"
    ON swimming_posts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can only update their own posts
CREATE POLICY "Users update own swimming_posts"
    ON swimming_posts FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can only delete their own posts
CREATE POLICY "Users delete own swimming_posts"
    ON swimming_posts FOR DELETE
    USING (auth.uid() = user_id);

-- Index for feed query (most common: upcoming posts ordered by swim_datetime)
CREATE INDEX IF NOT EXISTS idx_swimming_posts_datetime
    ON swimming_posts (swim_datetime ASC);

CREATE INDEX IF NOT EXISTS idx_swimming_posts_expires
    ON swimming_posts (expires_at ASC);


-- ── Table 2: swimming_post_interest ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS swimming_post_interest (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id       uuid NOT NULL REFERENCES swimming_posts(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    interest_type text NOT NULL CHECK (interest_type IN ('join', 'maybe')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (post_id, user_id)   -- one response per user per post
);

ALTER TABLE swimming_post_interest ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read interest (needed to show join counts)
CREATE POLICY "Auth users read interest"
    ON swimming_post_interest FOR SELECT
    USING (auth.role() = 'authenticated');

-- Users insert/update their own interest only
CREATE POLICY "Users insert own interest"
    ON swimming_post_interest FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own interest"
    ON swimming_post_interest FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users delete own interest"
    ON swimming_post_interest FOR DELETE
    USING (auth.uid() = user_id);
