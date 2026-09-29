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
-- Migration: 2026-09-29_ui-v2-default-all-flag.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Create the 'ui_v2_default_all' feature flag. The app (app-v2.js, autoDesignDecision) reads it to decide whether
--   EVERY signed-in user who has not chosen a design is switched to the new design (v2). Created OFF globally with
--   only Dave allowed, so the automatic switch can be tested on one account first. Going live for everyone is a
--   separate, later change (below), and is also the kill switch: setting enabled_global back to false returns
--   every auto-switched person to Classic. People who chose a design themselves (or chose Classic) are never touched.

-- Requested by:
--   Dave (make the new design the default for all users, 29 Sep 2026).

-- Pre-checks (read-only, run 29 Sep 2026 before writing this file):
--   feature_flags has columns key, enabled_global, allowed_user_ids, config, updated_at.
--   No row with key = 'ui_v2_default_all' exists (count = 0).
--   Dave's profile df137255-3add-4153-b368-32e06e2be188 exists (is_admin = true).
--   Related flag ui_v2_default_aquasharks exists: enabled_global = false, allowed = Dave only.

-- Backup:
--   Not needed. INSERT of one new row only; no UPDATE / DELETE / DROP / TRUNCATE.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('ui_v2_default_all', false, ARRAY['df137255-3add-4153-b368-32e06e2be188']::uuid[]);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DELETE FROM feature_flags WHERE key = 'ui_v2_default_all';
--   (The app fails closed when the row is absent: nobody is switched.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
--   SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key = 'ui_v2_default_all';
--   -- expect 1 row: enabled_global = false, allowed_user_ids = {df137255-3add-4153-b368-32e06e2be188}

-- ----------------------------------------------------------------
-- GO LIVE FOR EVERYONE (separate approved change — never edit this file)
--   UPDATE feature_flags SET enabled_global = true, updated_at = now() WHERE key = 'ui_v2_default_all';
-- KILL SWITCH (undo go-live)
--   UPDATE feature_flags SET enabled_global = false, updated_at = now() WHERE key = 'ui_v2_default_all';
-- ----------------------------------------------------------------
