-- Migration: 2026-09-30_instagram-story-flag-open-to-all.sql   (APPLIED 30 Sep 2026, ~12:21 UTC)
-- Purpose: open the Instagram story card (app-ig-story.js) to every swimmer.
-- Approved by Dave in chat ("open the flag - apply"), ahead of the September newsletter that announces it.
-- Only tested on iPhone; Android untested at the time of opening.

UPDATE feature_flags SET enabled_global = true, updated_at = now()
WHERE key = 'instagram_story_v1' AND enabled_global = false;

-- Verify: SELECT key, enabled_global FROM feature_flags WHERE key = 'instagram_story_v1';   -- enabled_global = true
-- Rollback (instantly hides it again, allow-list stays):
--   UPDATE feature_flags SET enabled_global = false, updated_at = now() WHERE key = 'instagram_story_v1';
