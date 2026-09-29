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
-- Migration: 2026-09-29_club-session-cancellations.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   New table club_session_cancellations: records that a scheduled session did not run on a given date
--   (public holiday, pool closed, coach away with no cover). The admin Today page and the coach banner
--   stop counting a cancelled session as a missed register. squad_session_id NULL = every session that day.

-- Requested by:
--   Dave (attendance workflow, 29 Sep 2026). Club: Aquasharks. Gated in the app by squads + timetable + attendance flags.

-- Pre-checks (read-only, run 29 Sep 2026 before writing this file — see results in chat):
--   club_session_cancellations does not exist.
--   club_squad_sessions.id is uuid; clubs.id is uuid; club_admins / club_coaches have (club_id, user_id[, is_active]).

-- Backup:
--   Not needed. CREATE TABLE + policies only; no UPDATE / DELETE / DROP / TRUNCATE of existing data.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE club_session_cancellations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  session_date      date NOT NULL,
  squad_session_id  uuid REFERENCES club_squad_sessions(id) ON DELETE CASCADE,  -- NULL = all sessions that day
  reason            text,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per (club, date, session); the coalesce makes "whole day" unique too (NULLs are otherwise distinct)
CREATE UNIQUE INDEX club_session_cancellations_uniq
  ON club_session_cancellations (club_id, session_date, COALESCE(squad_session_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX club_session_cancellations_club_date ON club_session_cancellations (club_id, session_date);

ALTER TABLE club_session_cancellations ENABLE ROW LEVEL SECURITY;

-- Same audience as club_sessions writes: club admins and active coaches of that club
CREATE POLICY cancellations_read_admin_coach ON club_session_cancellations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM club_admins a WHERE a.club_id = club_session_cancellations.club_id AND a.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM club_coaches c WHERE c.club_id = club_session_cancellations.club_id AND c.user_id = auth.uid() AND c.is_active = true)
  );

CREATE POLICY cancellations_write_admin_coach ON club_session_cancellations FOR ALL
  USING (
    EXISTS (SELECT 1 FROM club_admins a WHERE a.club_id = club_session_cancellations.club_id AND a.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM club_coaches c WHERE c.club_id = club_session_cancellations.club_id AND c.user_id = auth.uid() AND c.is_active = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM club_admins a WHERE a.club_id = club_session_cancellations.club_id AND a.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM club_coaches c WHERE c.club_id = club_session_cancellations.club_id AND c.user_id = auth.uid() AND c.is_active = true)
  );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DROP TABLE club_session_cancellations;
--   (Only ever holds cancellation markers created by this feature; no other table references it.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
--   SELECT count(*) FROM club_session_cancellations;                                   -- expect 0
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'club_session_cancellations';  -- expect t
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'club_session_cancellations';  -- expect 2 rows (SELECT, ALL)
