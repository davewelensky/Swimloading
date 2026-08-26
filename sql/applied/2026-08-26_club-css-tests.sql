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
-- Migration: 2026-08-26_club-css-tests.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   New table for Critical Swim Speed (CSS) test tracking. Britt runs a
--   CSS test per squad periodically (400m + 200m time trial from a push
--   start) to set training paces — did one for the OW Masters squads
--   today. No existing table fits: club_swimmer_times is specifically
--   gala/meet PBs (has meet_name, gala_event_id, is_pb) and mixing a
--   training time-trial into that would be semantically wrong and could
--   pollute real PB tracking. This is a purpose-built table instead,
--   same reasoning as club_trial_attendees earlier this session.
--
--   CSS formula (standard): css_pace_per_100 = (time_400 - time_200) / 2
--   Stored as a GENERATED column so it can never be entered wrong or
--   drift from the raw times.

-- Requested by:
--   Britt (Aquasharks), via Dave — needs to record today's OW Masters
--   CSS test results once this exists.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables WHERE table_name = 'club_css_tests';
-- -- expect: 0 (new table)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- New table only, nothing existing touched — no backup needed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE club_css_tests (
  id                        uuid primary key default gen_random_uuid(),
  club_id                   uuid not null references clubs(id) on delete cascade,
  roster_id                 uuid not null references club_roster(id) on delete cascade,
  squad_id                  uuid not null references club_squads(id) on delete cascade,
  test_date                 date not null,
  time_400_seconds          numeric not null,
  time_200_seconds          numeric not null,
  css_pace_per_100_seconds  numeric generated always as (round(((time_400_seconds - time_200_seconds) / 2.0)::numeric, 2)) stored,
  notes                     text,
  created_by                uuid references auth.users(id),
  created_at                timestamptz not null default now(),
  unique (roster_id, test_date)
);

CREATE INDEX idx_club_css_tests_squad_date ON club_css_tests (squad_id, test_date);
CREATE INDEX idx_club_css_tests_roster ON club_css_tests (roster_id, test_date);

ALTER TABLE club_css_tests ENABLE ROW LEVEL SECURITY;

-- Same pattern as club_trial_attendees/club_session_assignments: admins/
-- organisers full CRUD, coaches read-only (they can see CSS paces to plan
-- sets, but Britt is the one running/recording the test).
CREATE POLICY css_tests_admin_all ON club_css_tests
  FOR ALL
  USING (is_club_admin_or_organiser(club_id))
  WITH CHECK (is_club_admin_or_organiser(club_id));

CREATE POLICY css_tests_coach_read ON club_css_tests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM club_admins ca
      WHERE ca.user_id = auth.uid()
        AND ca.club_id = club_css_tests.club_id
        AND ca.role = 'coach'
    )
  );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS club_css_tests;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables WHERE table_name = 'club_css_tests';
-- -- expect: 1
-- SELECT policyname FROM pg_policies WHERE tablename = 'club_css_tests' ORDER BY policyname;
-- -- expect: css_tests_admin_all, css_tests_coach_read
