-- Migration: 2026-10-04_instagram-story-editor-go-live.sql   (APPLIED 4 Oct 2026, after Dave typed "apply")
-- Purpose:   Turn the Instagram story EDITOR (app-ig-editor.js) on for everyone: feature_flags.instagram_story_editor_v1
--            enabled_global = true. Dave tested it on his own phone first (flag was off globally, Dave only).
-- Backup:    _bak_20261004_feature_flags_instagram_story_editor (copy of the flag row before the change; enabled_global was false)
-- Rollback / kill switch (people instantly get the simple card again):
--            UPDATE feature_flags SET enabled_global = false, updated_at = now() WHERE key = 'instagram_story_editor_v1';
-- Verify:    SELECT enabled_global FROM feature_flags WHERE key='instagram_story_editor_v1';  -- true
--            SELECT count(*) FROM _bak_20261004_feature_flags_instagram_story_editor;           -- 1

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key = 'project_name' AND value = 'swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT - migration aborted';
  END IF;
END $$;

CREATE TABLE _bak_20261004_feature_flags_instagram_story_editor AS
  SELECT * FROM feature_flags WHERE key = 'instagram_story_editor_v1';

UPDATE feature_flags
   SET enabled_global = true, updated_at = now()
 WHERE key = 'instagram_story_editor_v1';
