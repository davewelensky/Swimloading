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
-- Migration: 2026-09-30_squad-targeting-events-announcements.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Let a club target an event (gala) or announcement at specific squads so a
--   swimmer only sees what is relevant to them (an OW Masters swimmer was seeing
--   QM5 LC and "Seniors only" notices). NULL or empty = visible to everyone, so
--   every existing row keeps its current behaviour. Schema only — no data is
--   tagged here; tagging existing events is a separate, confirmed step.

-- Requested by:
--   Dave, on Britt's swimmers' feedback — 30 Sep 2026

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.columns
--   WHERE table_name IN ('club_events','club_announcements') AND column_name = 'squad_ids';
--   -> expect 0 (neither column exists yet). Ran: 0 / 0.
-- Aquasharks currently has 26 events and 4 announcements; no rows are updated.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- N/A — adds two nullable columns; no rows are modified, deleted or dropped.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE club_events        ADD COLUMN IF NOT EXISTS squad_ids uuid[];
ALTER TABLE club_announcements ADD COLUMN IF NOT EXISTS squad_ids uuid[];

COMMENT ON COLUMN club_events.squad_ids IS
  'Squads this event is for. NULL/empty = everyone in the club. Used by the swimmer/parent view to hide events that are not theirs.';
COMMENT ON COLUMN club_announcements.squad_ids IS
  'Squads this announcement is for. NULL/empty = everyone in the club.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_<table>"
-- ----------------------------------------------------------------
-- ALTER TABLE club_events        DROP COLUMN squad_ids;
-- ALTER TABLE club_announcements DROP COLUMN squad_ids;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT table_name, column_name, data_type FROM information_schema.columns
--   WHERE table_name IN ('club_events','club_announcements') AND column_name = 'squad_ids';
--   -> expect 2 rows, data_type ARRAY.
-- SELECT count(*) FROM club_events WHERE squad_ids IS NOT NULL;   -- expect 0 (nothing tagged yet)
