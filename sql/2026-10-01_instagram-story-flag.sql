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
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT — MIGRATION ABORTED                       ║\n'
      '║                                                          ║\n'
      '║  This migration is for: SwimLoading                     ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh            ║\n'
      '║                                                          ║\n'
      '║  You are connected to a DIFFERENT Supabase project.     ║\n'
      '║  No changes have been made. Check your browser URL.     ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-10-01_instagram-story-flag.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Create the 'instagram_story_v1' feature flag for the Instagram story card prototype
--   (app-ig-story.js, hooked into the v2 Logged screen). OFF globally, Dave only, so nothing
--   changes for any other swimmer. The app fails closed when the row is absent.

-- Requested by:
--   Dave (Carina's idea, 30 Sep 2026)

-- Pre-checks (run before applying):
--   SELECT count(*) FROM feature_flags WHERE key = 'instagram_story_v1';   -- expect 0

-- Backup:
--   Not needed. INSERT of one new row only; no UPDATE / DELETE / DROP / TRUNCATE.

-- ----------------------------------------------------------------
-- MIGRATION: applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('instagram_story_v1', false, ARRAY['df137255-3add-4153-b368-32e06e2be188']::uuid[]);

COMMIT;

-- Rollback:
--   DELETE FROM feature_flags WHERE key = 'instagram_story_v1';

-- Verify (read-only, run after applying):
--   SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key = 'instagram_story_v1';
--   Expect exactly 1 row: enabled_global = false, allowed_user_ids = {df137255-3add-4153-b368-32e06e2be188}.

-- Later, to add a tester (a separate approved change):
--   UPDATE feature_flags
--      SET allowed_user_ids = array_append(allowed_user_ids, '<user uuid>'::uuid), updated_at = now()
--    WHERE key = 'instagram_story_v1' AND NOT ('<user uuid>'::uuid = ANY(allowed_user_ids));
