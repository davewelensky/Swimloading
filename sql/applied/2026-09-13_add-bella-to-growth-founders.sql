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
-- Migration: 2026-09-13_add-bella-to-growth-founders.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ⛔ PROPOSED — NOT YET APPLIED. Awaiting Dave's review and
--            the literal word "apply" per MIGRATIONS.md step 4.
-- ================================================================

-- Purpose:
--   Add Bella (bella.welensky@gmail.com) to growth_founders so she can
--   sign in to content-calendar.html, which was gated behind
--   growth_founders membership on 2026-09-13 (commit 7a0bd70) as part of
--   the Thalass-competitor IP/security review. She is already the named
--   assignee on multiple posts in that calendar (content-calendar.html
--   data-assignee="Bella") but had no growth_founders row, so she would
--   get a 403 from /api/content-calendar-data on login.

-- Requested by:
--   Dave, 2026-09-13

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM growth_founders WHERE email = 'bella.welensky@gmail.com';
--   -- ran 2026-09-13: 0 rows (confirms no existing row, unique constraint
--   -- growth_founders_email_key will not be violated)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not applicable — pure INSERT of one new row, nothing existing is
-- touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO growth_founders (email, name, country, role, status, regional_email)
VALUES (
  'bella.welensky@gmail.com',
  'Bella',
  'ZA',
  'founder',
  'Active',
  NULL
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM growth_founders WHERE email = 'bella.welensky@gmail.com';
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT email, name, country, role, status FROM growth_founders
--   WHERE email = 'bella.welensky@gmail.com';
--   -- expect: exactly 1 row, role='founder', status='Active'
