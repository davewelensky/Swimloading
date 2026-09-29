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
-- Migration: 2026-09-29_parent-child-timetable-rpc.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Let a parent see their child's squad timetable in the app. Squad sessions (club_squad_sessions) are
--   readable by club_members and admins only (is_club_active_member), so a parent with an approved
--   parent_roster_links row cannot read them. Rather than widen table policies, add ONE read-only
--   SECURITY DEFINER function that returns the child's timetable ONLY when the caller is an approved
--   parent of that exact roster row. Used by app-v2-club.js (parent view of the Club page and Today).

-- Requested by:
--   Dave (Aquasharks parent view, 29 Sep 2026)

-- Pre-checks (read-only, run 29 Sep 2026):
--   parent_roster_links columns: id, parent_user_id, roster_id, club_id, relationship, status, ...
--   7 approved links (7 parents). Function name get_child_timetable_v1 is unused (count = 0).
--   Logic validated read-only on one real approved link: resolves the child's squad (Senior Squad)
--   and returns its 7 active sessions.

-- Backup:
--   Not needed. Creates one new function; no existing object is altered, no rows are touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.get_child_timetable_v1(p_roster_id uuid)
RETURNS TABLE (
  child_squad_name text,
  owner_squad_name text,
  owner_squad_type text,
  day_of_week      smallint,
  start_time       text,
  end_time         text,
  custom_name      text,
  coach_name       text,
  notes            text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    -- the caller must be an APPROVED parent of exactly this roster row
    SELECT r.squad_id
      FROM parent_roster_links l
      JOIN club_roster r ON r.id = l.roster_id
     WHERE l.parent_user_id = auth.uid()
       AND l.status = 'approved'
       AND l.roster_id = p_roster_id
     LIMIT 1
  )
  SELECT (SELECT s.name FROM club_squads s WHERE s.id = me.squad_id),
         o.name,
         o.type,
         ss.day_of_week,
         to_char(ss.start_time, 'HH24:MI'),
         to_char(ss.end_time,   'HH24:MI'),
         ss.custom_name,
         ss.coach_name,
         ss.notes
    FROM me
    JOIN club_squad_sessions ss
      ON ss.is_active
     AND (ss.squad_id = me.squad_id
          OR ss.secondary_squad_id = me.squad_id
          OR me.squad_id = ANY (ss.linked_squad_ids))
    JOIN club_squads o ON o.id = ss.squad_id
   WHERE me.squad_id IS NOT NULL
   ORDER BY ss.day_of_week, ss.start_time;
$$;

REVOKE ALL ON FUNCTION public.get_child_timetable_v1(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_child_timetable_v1(uuid) TO authenticated;

COMMIT;

-- Rollback:
--   DROP FUNCTION public.get_child_timetable_v1(uuid);
--   (The app falls back to "timetable not visible to parents yet" when the function is absent.)

-- Verify (read-only, run after applying):
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'get_child_timetable_v1';   -- 1 row, prosecdef = true
--   As a non-parent (e.g. run with no auth.uid()): SELECT count(*) FROM get_child_timetable_v1('<any roster uuid>');  -- 0 rows
--   As an approved parent (in the app): the child's sessions appear on Club > This week.
