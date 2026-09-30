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
-- Migration: 2026-09-30_tag-seniors-only-announcement.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Tag the Aquasharks announcement "Thursday morning sessions — Seniors only"
--   with squad_ids = [Senior Squad] so it stops showing to non-senior swimmers
--   (e.g. OW Masters). The only announcement/event tagged in this step; the
--   upcoming galas are left for Britt to tag with the new "Who is this for?" picker.

-- Requested by:
--   Dave ("apply just that one"), 30 Sep 2026

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT id, title, squad_ids FROM club_announcements WHERE id = 'eea9f8b5-bdc6-40f5-90d2-9714d8667214';
--   -> ran: 1 row, squad_ids NULL. Affected rows on apply: 1.
-- SELECT name FROM club_squads WHERE id = 'a1000001-0000-0000-0000-000000000007';  -> 'Senior Squad'

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260930_club_announcements AS
  SELECT * FROM club_announcements WHERE id = 'eea9f8b5-bdc6-40f5-90d2-9714d8667214';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE club_announcements
   SET squad_ids = ARRAY['a1000001-0000-0000-0000-000000000007']::uuid[]
 WHERE id = 'eea9f8b5-bdc6-40f5-90d2-9714d8667214';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_<table>"
-- ----------------------------------------------------------------
-- UPDATE club_announcements SET squad_ids = NULL WHERE id = 'eea9f8b5-bdc6-40f5-90d2-9714d8667214';
-- (original row also preserved in _bak_20260930_club_announcements)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT id, squad_ids FROM club_announcements WHERE squad_ids IS NOT NULL;
--   -> expect exactly 1 row: eea9f8b5-..., {a1000001-0000-0000-0000-000000000007}
