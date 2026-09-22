-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key = 'project_name' AND value = 'swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-09-23_bluefin-youth-only-parent-search-and-known-accounts.sql
-- ================================================================

-- Purpose:
--   1. SHARED CODE CHANGE (affects DUC/Aquasharks/K8/Bluefin alike):
--      the search_roster_entries_for_linking() RPC backs both the
--      swimmer's own-name self-match (join.html, called with
--      p_roster_id — must stay unrestricted, any member type
--      self-registers) AND a parent's free-text child search (called
--      with p_query — this is what should be youth-only). Today
--      neither path filters by member_type at all, so a parent search
--      can surface adult Masters swimmers. Restricting only the
--      p_query path to member_type='youth' fixes Dave's ask for
--      Bluefin (only Reddam College kids should be parent-linkable,
--      not Masters) without touching the self-match path any club
--      relies on. club-admin.html's own "Invite a parent" search was
--      already fixed client-side in the previous turn.
--   2. Link the 3 Bluefin Masters members who turned out to already
--      have real SwimLoading accounts, found by matching their
--      spreadsheet emails against profiles: Debbie Smith, Monica
--      Theron, Hannah Borthwick. Same treatment as Tracey earlier —
--      skips the join-link step for people already confirmed.

-- Requested by:
--   Dave — "in progress reports, we only want the college students to
--   have a parents link, not the masters squads" (confirmed "yes, go
--   ahead") + "we will find some of these swimmers on swimloading
--   already"

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- Current function definition confirmed via pg_get_functiondef — no
-- member_type filtering on either p_roster_id or p_query paths.
-- Profile matches confirmed via SELECT ... WHERE email IN (...):
--   debbiejoysmith@gmail.com -> 11ec21d8-fde9-499f-a3c9-825b5445158b (Debbie Smith)
--   monica23@live.co.za      -> 4eca760a-55c0-47b7-919b-67aaa566a78c (Monica Theron)
--   borthwick.hannah@gmail.com -> 5a4006d7-3ac5-43b7-a636-cc3f996e2905 (Hannah Borthwick)
-- The 3 UPDATEs below touch exactly those 3 existing club_roster rows
-- (currently user_id IS NULL on all three).

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260923_search_roster_fn AS
  SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'search_roster_entries_for_linking';
CREATE TABLE _bak_20260923_club_roster_bluefin_userids AS
  SELECT id, display_name, user_id FROM club_roster
  WHERE club_id = (SELECT id FROM clubs WHERE slug = 'bluefin');

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.search_roster_entries_for_linking(
  p_club_id uuid, p_query text DEFAULT NULL::text,
  p_member_number integer DEFAULT NULL::integer, p_roster_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, member_number integer, display_name text, category text, gender character, squad_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT r.id, r.member_number, r.display_name, r.category, r.gender, r.squad_id
  FROM club_roster r
  WHERE r.club_id = p_club_id
    AND auth.role() = 'authenticated'
    AND (p_roster_id IS NULL OR r.id = p_roster_id)
    AND (p_member_number IS NULL OR r.member_number = p_member_number)
    AND (p_query IS NULL OR (length(p_query) >= 2 AND r.display_name ILIKE '%' || p_query || '%'))
    AND (p_query IS NULL OR r.member_type = 'youth')
    AND (p_roster_id IS NOT NULL OR p_member_number IS NOT NULL OR p_query IS NOT NULL)
  ORDER BY r.display_name
  LIMIT 10;
$function$;

UPDATE club_roster SET user_id = '11ec21d8-fde9-499f-a3c9-825b5445158b'
  WHERE club_id = (SELECT id FROM clubs WHERE slug = 'bluefin') AND display_name = 'Debbie Smith';
UPDATE club_roster SET user_id = '4eca760a-55c0-47b7-919b-67aaa566a78c'
  WHERE club_id = (SELECT id FROM clubs WHERE slug = 'bluefin') AND display_name = 'Monica Theron';
UPDATE club_roster SET user_id = '5a4006d7-3ac5-43b7-a636-cc3f996e2905'
  WHERE club_id = (SELECT id FROM clubs WHERE slug = 'bluefin') AND display_name = 'Hannah Borthwick';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- Restore prior function: run the `def` text from _bak_20260923_search_roster_fn.
-- UPDATE club_roster SET user_id = NULL WHERE id IN (
--   SELECT id FROM club_roster WHERE club_id=(SELECT id FROM clubs WHERE slug='bluefin')
--   AND display_name IN ('Debbie Smith','Monica Theron','Hannah Borthwick'));

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT display_name, user_id FROM club_roster WHERE club_id=(SELECT id FROM clubs WHERE slug='bluefin')
--   AND display_name IN ('Debbie Smith','Monica Theron','Hannah Borthwick');
--   -- expect: all 3 with non-null user_id
-- SELECT * FROM search_roster_entries_for_linking(p_club_id := (SELECT id FROM clubs WHERE slug='bluefin'), p_query := 'a');
--   -- expect: only youth (Reddam College) rows come back, no Masters names
