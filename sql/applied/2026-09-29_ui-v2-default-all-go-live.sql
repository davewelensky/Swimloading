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
-- Migration: 2026-09-29_ui-v2-default-all-go-live.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   GO LIVE: make the new design (v2) the default for every signed-in user who has not chosen a design.
--   Sets feature_flags.ui_v2_default_all enabled_global = true. Effect (app-v2.js, shipped cd38dc2): on a person's next
--   visit to /app they are moved once to the new design; anyone who chose Classic or chose the new design themselves is
--   never changed. A person can always return via You > Classic design.

-- Requested by:
--   Dave (29 Sep 2026: "make it the default now"). Tested by Dave on the live site: auto-switch, kept URL, Classic opt-out.

-- Pre-checks (read-only, run 29 Sep 2026):
--   ui_v2_default_all exists: enabled_global = false, allowed_user_ids = {Dave}.   Rows to update: 1.
--   profiles: 747. Every signed-in user who opens /app and has not opted out will be switched.

-- Backup (UPDATE => required): copy of the flag row before the change.
-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _bak_20260929_feature_flags_ui_v2_default_all AS
  SELECT * FROM feature_flags WHERE key = 'ui_v2_default_all';

UPDATE feature_flags
   SET enabled_global = true, updated_at = now()
 WHERE key = 'ui_v2_default_all';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK / KILL SWITCH — takes effect on each person's next load; auto-switched people return to Classic
-- ----------------------------------------------------------------
--   UPDATE feature_flags SET enabled_global = false, updated_at = now() WHERE key = 'ui_v2_default_all';
--   People who chose the new design themselves (?ui=v2, or the in-app switch) stay on it, by design.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
--   SELECT key, enabled_global FROM feature_flags WHERE key = 'ui_v2_default_all';           -- expect enabled_global = true
--   SELECT count(*) FROM _bak_20260929_feature_flags_ui_v2_default_all;                       -- expect 1
