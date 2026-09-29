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
-- Migration: 2026-09-29_ui-v2-default-aquasharks-flag.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Create the 'ui_v2_default_aquasharks' feature flag: the switch that makes the new design (v2) the
--   default for Aquasharks swimmers and parents who have not chosen a design themselves (app-v2.js,
--   runAutoDesign). OFF globally, Dave only, so nothing changes for anyone else until the flag is widened.
--   Rollout stages are later, separately approved UPDATEs (see bottom): add Britt, then enabled_global.
--   Turning it back off reverts everyone who was auto-switched (people who chose a design themselves,
--   or chose "Classic design", are never touched).

-- Requested by:
--   Dave (v2 default for Aquasharks, 29 Sep 2026)

-- Pre-checks (read-only, 29 Sep 2026):
--   feature_flags exists (key, enabled_global, allowed_user_ids, config, updated_at).
--   No row with key 'ui_v2_default_aquasharks' (verify count = 0 before applying).
--   Dave's profile df137255-3add-4153-b368-32e06e2be188 exists (KGB, is_admin).

-- Backup:
--   Not needed. INSERT of one new row only.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('ui_v2_default_aquasharks', false, ARRAY['df137255-3add-4153-b368-32e06e2be188']::uuid[]);

COMMIT;

-- Rollback:
--   DELETE FROM feature_flags WHERE key = 'ui_v2_default_aquasharks';
--   (Fails closed: with no row the app changes nothing. Anyone already auto-switched stays until they
--    switch back, so prefer setting enabled_global = false AND removing them from allowed_user_ids, which
--    makes the app revert auto-switched users on their next visit.)

-- Verify (read-only, after applying):
--   SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key = 'ui_v2_default_aquasharks';
--   Expect 1 row: enabled_global = false, allowed_user_ids = {df137255-3add-4153-b368-32e06e2be188}.

-- Rollout stages (each a separate approved change, never edit this file):
--   1. Add a trial user (e.g. Britt 7ade0520-0cf0-4dfb-8275-f053a17a836c):
--        UPDATE feature_flags SET allowed_user_ids = array_append(allowed_user_ids, '<uuid>'::uuid), updated_at = now()
--         WHERE key = 'ui_v2_default_aquasharks' AND NOT ('<uuid>'::uuid = ANY(allowed_user_ids));
--   2. Everyone in Aquasharks:  UPDATE feature_flags SET enabled_global = true, updated_at = now() WHERE key = 'ui_v2_default_aquasharks';
--   3. Stop / roll back:        UPDATE feature_flags SET enabled_global = false, allowed_user_ids = '{}', updated_at = now() WHERE key = 'ui_v2_default_aquasharks';
