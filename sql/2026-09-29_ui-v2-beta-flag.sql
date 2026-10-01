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
-- Migration: 2026-09-29_ui-v2-beta-flag.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Create the 'ui_v2_beta' feature flag. The app (app-v2.js, V2.canOfferV2) reads it to decide
--   who is offered the "Try the new design (beta)" switch in Profile Settings. Admins always get
--   the offer; this flag is how specific testers get it too. OFF globally, Dave only, so nothing
--   changes for any other swimmer. Testers are added later with the one-liner at the bottom.

-- Requested by:
--   Dave (new design rollout, 29 Sep 2026)

-- Pre-checks (read-only, run 29 Sep 2026 before writing this file):
--   feature_flags exists with columns key, enabled_global, allowed_user_ids, config, updated_at.
--   No row with key = 'ui_v2_beta' exists (count = 0).
--   Dave's profile df137255-3add-4153-b368-32e06e2be188 exists (display_name KGB, is_admin = true).
--   Existing flags for reference: identity_layer_v1, passport_v1, passport_moment_v1, overview_v2,
--   story_engine_v1, story_timeline_v1, story_cards_v1 (all enabled_global = true).

-- Backup:
--   Not needed. INSERT of one new row only; no UPDATE / DELETE / DROP / TRUNCATE.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('ui_v2_beta', false, ARRAY['df137255-3add-4153-b368-32e06e2be188']::uuid[]);

COMMIT;

-- Rollback:
--   DELETE FROM feature_flags WHERE key = 'ui_v2_beta';
--   (The app fails closed when the row is absent: only admins are then offered the switch.)

-- Verify (read-only, run after applying):
--   SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key = 'ui_v2_beta';
--   Expect exactly 1 row: enabled_global = false, allowed_user_ids = {df137255-3add-4153-b368-32e06e2be188}.

-- Later, to add a tester (a separate approved change, never edit this file):
--   UPDATE feature_flags
--      SET allowed_user_ids = array_append(allowed_user_ids, '<user uuid>'::uuid), updated_at = now()
--    WHERE key = 'ui_v2_beta' AND NOT ('<user uuid>'::uuid = ANY(allowed_user_ids));
--   To open it to everyone: UPDATE feature_flags SET enabled_global = true WHERE key = 'ui_v2_beta';
