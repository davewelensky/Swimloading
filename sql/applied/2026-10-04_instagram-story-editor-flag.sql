-- ================================================================
-- SwimLoading — Migration
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT - migration aborted. Expected swimloading (szgkzuswelntnevobnoh).';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-10-04_instagram-story-editor-flag.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Create the 'instagram_story_editor_v1' feature flag. app-ig-story.js reads it to decide whether the "Share to
--   Instagram" button opens the new story EDITOR (app-ig-editor.js: movable text, colours, layouts, photo framing,
--   hashtag in the picture, ready caption) instead of the simple card that is live today. OFF globally, Dave only,
--   so the editor can be tried on a real phone before anyone else sees it. Fails closed: no row => simple card.

-- Requested by:
--   Dave (improve the Instagram story sharing, 4 Oct 2026).

-- Pre-checks (read-only, run 4 Oct 2026 before writing this file):
--   No row with key = 'instagram_story_editor_v1' exists. The existing 'instagram_story_v1' flag is enabled_global = true
--   (the simple card is live for everyone) and is NOT touched by this migration.

-- Backup:
--   Not needed. INSERT of one new row only; no UPDATE / DELETE / DROP / TRUNCATE.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('instagram_story_editor_v1', false, ARRAY['df137255-3add-4153-b368-32e06e2be188']::uuid[]);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DELETE FROM feature_flags WHERE key = 'instagram_story_editor_v1';   (everyone gets the simple card again)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
--   SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key = 'instagram_story_editor_v1';
--   -- expect 1 row: enabled_global = false, allowed_user_ids = {df137255-3add-4153-b368-32e06e2be188}

-- ----------------------------------------------------------------
-- GO LIVE FOR EVERYONE (a later, separately approved change — never edit this file)
--   UPDATE feature_flags SET enabled_global = true, updated_at = now() WHERE key = 'instagram_story_editor_v1';
-- ----------------------------------------------------------------
