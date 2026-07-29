-- ================================================================
-- SwimLoading — Migration Template
-- Copy this header into EVERY new migration file.
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
-- Migration: 2026-07-29_welcome-email-fields.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Add one-time-send tracking columns to profiles so the new
--   server-side welcome email (sent after onboarding_completed_at
--   is first set) can never be sent twice, and so failures are
--   visible for support/debugging. Confirmed via inspection that no
--   equivalent columns exist anywhere on profiles.

-- Requested by:
--   Dave — July 2026 install/welcome-email work

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name LIKE 'welcome_email%';
-- -- expect: 0 rows (columns do not exist yet)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — this migration only ADDs nullable columns, no
-- existing data is modified or destroyed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_email_status   text,
  ADD COLUMN IF NOT EXISTS welcome_email_error     text;

COMMENT ON COLUMN profiles.welcome_email_sent_at IS 'Set once, server-side, when the post-onboarding welcome email successfully sends. Never re-sent once set.';
COMMENT ON COLUMN profiles.welcome_email_status IS 'sent | failed | null (never attempted)';
COMMENT ON COLUMN profiles.welcome_email_error IS 'Last error message if welcome_email_status = failed, for support debugging';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- ALTER TABLE profiles
--   DROP COLUMN IF EXISTS welcome_email_sent_at,
--   DROP COLUMN IF EXISTS welcome_email_status,
--   DROP COLUMN IF EXISTS welcome_email_error;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name LIKE 'welcome_email%';
-- -- expect: 3 rows — welcome_email_sent_at (timestamp with time zone),
-- --         welcome_email_status (text), welcome_email_error (text)
