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
-- Migration: 2026-08-27_club-css-roster-rpc.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   The swimmer CSS tab shows the whole club's results (intentional — Dave,
--   26 Aug), but club_roster RLS only lets a swimmer read their OWN row, so
--   every other swimmer's test was silently dropped client-side: Italia saw
--   one squad card containing only herself. A blanket member-read policy on
--   club_roster is NOT safe (rows carry phone, date_of_birth, fee status),
--   so this adds a SECURITY DEFINER function returning ONLY id /
--   display_name / gender for active roster rows, callable only by that
--   club's active members, admins/organisers, or coaches.

-- Requested by:
--   Dave, 27 Aug 2026 ("fix it and make sure all the css works" — swimmers
--   join from Britt's message; first squad sessions use it 28 Aug).

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. Function does not exist yet (expect: 0 rows)
-- SELECT proname FROM pg_proc WHERE proname = 'club_css_roster';
--
-- 2. Helper used in the guard exists (expect: 1 row)
-- SELECT proname FROM pg_proc WHERE proname = 'is_club_admin_or_organiser';
--
-- 3. Sanity: Aquasharks active roster count the function would expose names for
-- SELECT count(*) FROM club_roster
-- WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND is_active = true;

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — CREATE FUNCTION + GRANT only, no data touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION club_css_roster(p_club_id uuid)
RETURNS TABLE (id uuid, display_name text, gender text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.display_name, r.gender::text
  FROM club_roster r
  WHERE r.club_id = p_club_id
    AND r.is_active = true
    AND (
      EXISTS (
        SELECT 1 FROM club_members cm
        WHERE cm.user_id = auth.uid()
          AND cm.club_id = p_club_id
          AND cm.is_active = true
      )
      OR is_club_admin_or_organiser(p_club_id)
      OR EXISTS (
        SELECT 1 FROM club_admins ca
        WHERE ca.user_id = auth.uid()
          AND ca.club_id = p_club_id
          AND ca.role = 'coach'
      )
    );
$$;

REVOKE ALL ON FUNCTION club_css_roster(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION club_css_roster(uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP FUNCTION club_css_roster(uuid);
-- (app-club.js falls back to the own-row select if the function is missing)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'club_css_roster';
--   -- expect: 1 row, prosecdef = true
--
-- Unauthenticated context returns nothing (auth.uid() is NULL → all guards false):
-- SELECT count(*) FROM club_css_roster('385e2c9d-b32e-47d1-bb1d-1e042523de23');
--   -- expect on read-only/service connection without a user JWT: 0
