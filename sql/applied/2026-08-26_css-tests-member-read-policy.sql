-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-08-26_css-tests-member-read-policy.sql
-- ================================================================

-- Purpose:
--   Critical RLS gap found live: club_css_tests only had policies for
--   admins/organisers (css_tests_admin_all) and coaches
--   (css_tests_coach_read). A regular swimmer (club_members role='member')
--   had ZERO read access — the swimmer-facing CSS tab (app-club.js,
--   commit c933003) would silently return 0 rows for every real swimmer,
--   regardless of caching. Dave (admin role) and Britt (coach role) could
--   both see data fine, which is exactly why this wasn't caught until a
--   regular swimmer would have tried it. Design intent was explicit
--   "everyone sees everyone's times" — so this grants read to any active
--   club_members row for that club, not just the viewer's own tests.

-- Requested by:
--   Found and fixed live, 26 Aug 2026, mid-conversation with Dave.

-- Applied directly (pure additive SELECT policy, no data risk).

CREATE POLICY css_tests_member_read ON club_css_tests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM club_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.club_id = club_css_tests.club_id
        AND cm.is_active = true
    )
  );

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP POLICY css_tests_member_read ON club_css_tests;

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT policyname FROM pg_policies WHERE tablename = 'club_css_tests' ORDER BY policyname;
-- -- expect: css_tests_admin_all, css_tests_coach_read, css_tests_member_read
