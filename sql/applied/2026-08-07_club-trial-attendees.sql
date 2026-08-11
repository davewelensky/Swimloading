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
-- Migration: 2026-08-07_club-trial-attendees.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   New table for the "advance trial" feature Britt scoped out earlier:
--   let an admin pre-plan an EXISTING roster member trialing a squad
--   they're not normally in, for one specific date — the coach sees them
--   on that day's register with a TRIAL tag, with zero change to the
--   swimmer's actual squad membership. Distinct from:
--     - club_roster.is_trial (whether they're a trial CLUB member at all)
--     - club_session_assignments (PERMANENT recurring-slot assignment)
--     - the coach-side addFromRoster() walk-in (live, in-session only,
--       never persisted until that session's marks are saved, and only
--       reachable by a coach already inside that day's register)
--   None of those let an admin stage this in advance for a future day —
--   confirmed by reading the actual code before building this.

-- Requested by:
--   Britt (Aquasharks), via Dave — needs 2 trials added this week,
--   found no existing way to do it in advance

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables WHERE table_name = 'club_trial_attendees';
-- -- expect: 0 (new table)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- New table only, nothing existing touched — no backup needed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE club_trial_attendees (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references clubs(id) on delete cascade,
  roster_id    uuid not null references club_roster(id) on delete cascade,
  squad_id     uuid not null references club_squads(id) on delete cascade,
  session_date date not null,
  notes        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (roster_id, squad_id, session_date)
);

CREATE INDEX idx_club_trial_attendees_lookup
  ON club_trial_attendees (squad_id, session_date);

ALTER TABLE club_trial_attendees ENABLE ROW LEVEL SECURITY;

-- Same pattern as club_session_assignments: admins/organisers full CRUD,
-- coaches read-only (they need to see who's trialing, not manage it).
CREATE POLICY trial_attendees_admin_all ON club_trial_attendees
  FOR ALL
  USING (is_club_admin_or_organiser(club_id))
  WITH CHECK (is_club_admin_or_organiser(club_id));

CREATE POLICY trial_attendees_coach_read ON club_trial_attendees
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM club_admins ca
      WHERE ca.user_id = auth.uid()
        AND ca.club_id = club_trial_attendees.club_id
        AND ca.role = 'coach'
    )
  );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS club_trial_attendees;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables WHERE table_name = 'club_trial_attendees';
-- -- expect: 1
-- SELECT policyname FROM pg_policies WHERE tablename = 'club_trial_attendees' ORDER BY policyname;
-- -- expect: trial_attendees_admin_all, trial_attendees_coach_read
