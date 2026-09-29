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
-- Migration: 2026-09-29_parent-read-club-announcements.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Let an APPROVED parent read their own club's coach announcements. The two existing SELECT policies on
--   club_announcements cover club_members, club_admins and roster-linked users only, so parents (who have a
--   parent_roster_links row but no club_members row) see no announcements in the app, even though
--   announcements are the club's main channel to parents. Read-only, scoped to the parent's own club.

-- Requested by:
--   Dave (Aquasharks parent view, 29 Sep 2026)

-- Pre-checks (read-only, run 29 Sep 2026):
--   club_announcements SELECT policies: "Club members can read announcements" and read_club_announcements,
--   neither references parent_roster_links. Aquasharks has 4 announcements (2 pinned).
--   parent_roster_links: 7 approved links (7 parents). club_events is already readable by everyone
--   (events_public_read), so parents already see the gala calendar; only announcements are affected.

-- Backup:
--   Not needed. Adds one SELECT policy; no rows are touched and no existing policy is changed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE POLICY parent_read_club_announcements ON public.club_announcements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.parent_roster_links l
       WHERE l.parent_user_id = auth.uid()
         AND l.status = 'approved'
         AND l.club_id = club_announcements.club_id
    )
  );

COMMIT;

-- Rollback:
--   DROP POLICY parent_read_club_announcements ON public.club_announcements;

-- Verify (read-only, run after applying):
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE tablename = 'club_announcements' AND policyname = 'parent_read_club_announcements';
--   Expect 1 row: cmd = SELECT, roles = {authenticated}.
--   In the app, as an approved parent: Club shows "From the coach" with the club's announcements.
