-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected ref: szgkzuswelntnevobnoh';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-07-21_passport-moment-v1-flag.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Phase 2.5.1 — Swim Passport Moment + Door. A pure feature-flag row,
--   passport_moment_v1 (Dave, Carina, Johan — off globally). It gates
--   two client-only things in app-passport.js:
--     1. the post-log "moment" that stamps a swim into the passport and
--        surfaces "Open my Passport" (replaces the toast/card/share tail);
--     2. the persistent dashboard door (#passportDoor).
--   NO new RPC, function, table, column, index or policy. The moment
--   reuses the existing get_my_swim_passport_v1() for its numbers.
--
--   Separate flag from passport_v1 (which is global) so the new log-path
--   UI can be verified on the three of us before it reaches everyone.

-- Requested by:
--   Dave (SwimLoading Phase 2.5.1, 2026-07-21) — "the door + the moment,
--   flag-first".

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM feature_flags WHERE key='passport_moment_v1';  -- expect: 0

-- ----------------------------------------------------------------
-- BACKUP — not required, additive (one flag row).
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- df137255-3add-4153-b368-32e06e2be188 = Dave
-- cff2fc33-4a55-451b-8c7f-20f12c1898ce = Carina Bruwer
-- becb6930-c952-46b0-ae03-741a0721004d = Johan Branehog ("tunnan")
INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('passport_moment_v1', false, ARRAY[
  'df137255-3add-4153-b368-32e06e2be188',
  'cff2fc33-4a55-451b-8c7f-20f12c1898ce',
  'becb6930-c952-46b0-ae03-741a0721004d'
]::uuid[])
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DELETE FROM feature_flags WHERE key = 'passport_moment_v1';
-- Client reads the flag as false → the moment falls back to the existing
-- post-log chain and the dashboard door stays hidden. Nothing else.

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key='passport_moment_v1';
--   -- expect: 1 row, false, {Dave, Carina, Johan}
